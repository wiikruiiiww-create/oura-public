import { openUrl } from "@tauri-apps/plugin-opener";
import { useUpdaterContext } from "./hooks/UpdaterProvider";
import { Button } from "@/shared/ui/button";
import {
  SettingsOptionGroup,
  SettingsOptionRow,
} from "./ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "./ui/SettingsSectionHeader";
export function UpdateChecker() {
  const { status, checkForUpdate, installAndRelaunch } = useUpdaterContext();

  return (
    <section className="min-w-0" data-testid="settings-updates">
      <SettingsSectionHeader
        title="Обновления программы"
        description="Обновляйте OURA, чтобы получать новые функции и исправления."
      />

      <SettingsOptionGroup>
        {status.state === "idle" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Проверьте, доступна ли новая версия.
              </p>
            </div>
            <Button size="sm" onClick={checkForUpdate}>
              Проверить обновления
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "checking" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Проверка обновлений…
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "up-to-date" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Установлена последняя версия.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              Проверить снова
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "unavailable" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Автоматические обновления недоступны для этой сборки. Скачайте
                последний релиз вручную.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              Проверить снова
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "manual-required" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Доступно обновление — v{status.version}
              </p>
              <p className="text-sm font-normal text-muted-foreground">
                Обновление в приложении не поддерживается для этой сборки Linux.
                Скачайте новую версию с GitHub.{" "}
                <span className="text-muted-foreground">
                  Перейдите на сборку AppImage для автоматических обновлений.
                </span>
              </p>
            </div>
            <Button size="sm" onClick={() => void openUrl(status.releaseUrl)}>
              Скачать обновление
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "available" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Подготовка обновления…
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "downloading" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Скачивание обновления…
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "installing" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Установка обновления…
              </p>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "ready" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-muted-foreground">
                Обновление скачано. Нажмите, чтобы применить.
              </p>
            </div>
            <Button size="sm" onClick={installAndRelaunch}>
              Обновить сейчас
            </Button>
          </SettingsOptionRow>
        )}

        {status.state === "error" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">Статус обновления</p>
              <p className="text-sm font-normal text-destructive">
                Ошибка обновления: {status.message}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              Повторить
            </Button>
          </SettingsOptionRow>
        )}
      </SettingsOptionGroup>
    </section>
  );
}
