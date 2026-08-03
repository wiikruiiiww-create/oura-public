import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { Spinner } from "@/shared/ui/spinner";

import {
  cancelPairing,
  confirmPairingSas,
  startPairing,
} from "@/shared/api/tauri";
import { Button } from "@/shared/ui/button";
import { StyledQrCode } from "@/shared/ui/styled-qr-code";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

type PairingStep =
  | "generating"
  | "qr"
  | "sas"
  | "transferring"
  | "done"
  | "error";

function PairingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<PairingStep>("generating");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [sasCode, setSasCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  // Start pairing when dialog opens.
  useEffect(() => {
    if (!open) return;

    setStep("generating");
    setQrUri(null);
    setSasCode(null);
    setError(null);
    let cancelled = false;

    startPairing().then(
      (uri) => {
        if (!cancelled) {
          setQrUri(uri);
          setStep("qr");
        }
      },
      (err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Не удалось начать сеанс сопряжения",
          );
          setStep("error");
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Listen for Tauri events from the pairing backend.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<{ sas: string }>("pairing-sas-received", (event) => {
      if (!cancelled) {
        setSasCode(event.payload.sas);
        setStep("sas");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen("pairing-complete", () => {
      if (!cancelled) {
        setStep("done");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<{ reason: string }>("pairing-aborted", (event) => {
      if (!cancelled) {
        setError(`Сопряжение прервано: ${event.payload.reason}`);
        setStep("error");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<{ message: string }>("pairing-error", (event) => {
      if (!cancelled) {
        setError(event.payload.message);
        setStep("error");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, [open]);

  // Cancel pairing when dialog closes before completion.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && stepRef.current !== "done") {
        cancelPairing().catch(() => {});
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  async function handleConfirmSas() {
    setStep("transferring");
    try {
      await confirmPairingSas();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось отправить учётные данные",
      );
      setStep("error");
    }
  }

  function handleDenySas() {
    cancelPairing().catch(() => {});
    setError(
      "Коды SAS не совпадают — сопряжение отменено в целях безопасности.",
    );
    setStep("error");
  }

  async function handleCopy() {
    if (!qrUri) return;
    await writeTextToClipboard(qrUri);
    toast.success("Скопировано в буфер обмена");
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-w-md gap-0 overflow-hidden border-0 px-6 pb-6 pt-6"
        data-testid="mobile-pairing-dialog"
      >
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="shrink-0 pb-5 pr-8">
            <DialogTitle>Сопряжение с мобильным устройством</DialogTitle>
            <DialogDescription>
              {step === "sas"
                ? "Проверьте, что код безопасности совпадает с кодом на вашем мобильном устройстве."
                : step === "done"
                  ? "Ваше мобильное устройство сопряжено."
                  : "Отсканируйте этот QR-код в мобильном приложении OURA, чтобы безопасно выполнить сопряжение."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pt-4">
            {step === "error" && error ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : step === "generating" ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <Spinner className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Подготовка защищённого сеанса сопряжения…
                </p>
              </div>
            ) : step === "qr" && qrUri ? (
              <div className="mx-auto grid w-fit gap-4">
                <div
                  className="rounded-lg border border-border/70 bg-white p-3"
                  data-testid="mobile-pairing-qr-container"
                >
                  <StyledQrCode
                    centerImageSrc="/app-icon@2x.png"
                    data-testid="mobile-pairing-qr"
                    size={240}
                    title="QR-код для сопряжения с мобильным устройством"
                    value={qrUri}
                  />
                </div>

                <Button
                  className="w-full"
                  data-testid="copy-pairing-code"
                  onClick={handleCopy}
                  type="button"
                  variant="outline"
                >
                  <Copy className="mr-1.5 h-4 w-4" />
                  Скопировать код сопряжения
                </Button>
              </div>
            ) : step === "sas" && sasCode ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 py-4">
                  <ShieldCheck className="h-10 w-10 text-primary" />
                  <p className="text-sm font-medium">
                    Убедитесь, что этот код совпадает с кодом на вашем мобильном
                    устройстве
                  </p>
                  <div className="rounded-xl border-2 border-primary/30 bg-primary/5 px-8 py-4">
                    <p
                      className="font-mono text-4xl font-bold tracking-[0.3em]"
                      data-testid="pairing-sas-code"
                    >
                      {sasCode.slice(0, 3)} {sasCode.slice(3)}
                    </p>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Вы собираетесь передать свою личность OURA на другое
                    устройство. Подтверждайте, только если это сопряжение
                    инициировали вы.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    data-testid="deny-sas"
                    onClick={handleDenySas}
                    variant="outline"
                  >
                    <X className="mr-1.5 h-4 w-4" />
                    Отмена
                  </Button>
                  <Button
                    className="flex-1"
                    data-testid="confirm-sas"
                    onClick={handleConfirmSas}
                  >
                    <Check className="mr-1.5 h-4 w-4" />
                    Коды совпадают
                  </Button>
                </div>
              </div>
            ) : step === "transferring" ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <Spinner className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Отправка личности на мобильное устройство…
                </p>
              </div>
            ) : step === "done" ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-sm font-medium">
                  Мобильное устройство успешно сопряжено
                </p>
                <p className="text-center text-xs text-muted-foreground">
                  Ваше мобильное приложение теперь подключено к этому релею.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MobilePairingCard({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section className="min-w-0" data-testid="settings-mobile">
      <SettingsSectionHeader
        title="Мобильное"
        description={
          <>
            Подключите мобильное приложение OURA к этому релею, отсканировав
            QR-код. Соединение защищено сквозным шифрованием и кодом
            подтверждения.
          </>
        }
      />

      <SettingsOptionGroup>
        <SettingsOptionRow className="gap-3">
          <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Сопряжение с мобильным устройством
            </p>
            <p className="text-sm font-normal text-muted-foreground">
              Безопасная передача личности по протоколу NIP-AB
            </p>
          </div>
          <Button
            data-testid="pair-mobile-button"
            disabled={!currentPubkey}
            onClick={() => setDialogOpen(true)}
            size="sm"
          >
            Сопрячь
          </Button>
        </SettingsOptionRow>
      </SettingsOptionGroup>

      {currentPubkey && (
        <PairingDialog onOpenChange={setDialogOpen} open={dialogOpen} />
      )}
    </section>
  );
}
