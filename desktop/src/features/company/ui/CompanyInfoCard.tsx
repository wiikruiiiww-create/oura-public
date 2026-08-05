import * as React from "react";

import {
  type CompanyInfo,
  EMPTY_COMPANY_INFO,
  hasCompanyInfo,
} from "@/features/company/companyInfo";
import {
  useCompanyInfoQuery,
  useSaveCompanyInfoMutation,
} from "@/features/company/useCompanyInfo";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

/**
 * Сведения о компании — общие для всех внешних агентов. Заполняются один раз
 * здесь: агент подставляет их в каждый ответ клиенту, и дублировать их в базе
 * знаний каждого агента не нужно.
 */

type FieldKey = keyof CompanyInfo;

const FIELDS: Array<{
  key: FieldKey;
  label: string;
  hint: string;
  multiline?: boolean;
}> = [
  {
    key: "name",
    label: "Название",
    hint: "Как компания представляется клиентам.",
  },
  {
    key: "description",
    label: "Чем занимаетесь",
    hint: "Товары и услуги в двух-трёх предложениях — с этого агент начинает разговор.",
    multiline: true,
  },
  {
    key: "address",
    label: "Адрес",
    hint: "Куда приезжать клиенту. Оставьте пустым, если работаете удалённо.",
  },
  {
    key: "workingHours",
    label: "Режим работы",
    hint: "Например: пн–пт 9:00–18:00, сб–вс выходной.",
  },
  {
    key: "contacts",
    label: "Контакты",
    hint: "Телефон, почта, сайт — то, что агент может назвать клиенту.",
    multiline: true,
  },
];

export function CompanyInfoCard() {
  const query = useCompanyInfoQuery();
  const save = useSaveCompanyInfoMutation();
  const [form, setForm] = React.useState<CompanyInfo>(EMPTY_COMPANY_INFO);
  const [loadedFor, setLoadedFor] = React.useState<CompanyInfo | null>(null);

  // форма заполняется тем, что пришло с relay, но правки пользователя не
  // затирает: повторный ответ той же редакцией ничего не меняет
  const loaded = query.data ?? null;
  if (query.isSuccess && loaded !== loadedFor) {
    setLoadedFor(loaded);
    setForm(loaded ?? EMPTY_COMPANY_INFO);
  }

  const setField = (key: FieldKey, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const dirty =
    JSON.stringify(form) !== JSON.stringify(loaded ?? EMPTY_COMPANY_INFO);

  return (
    <section className="min-w-0" data-testid="settings-company">
      <SettingsSectionHeader
        description="Общие сведения о бизнесе. Внешние агенты опираются на них в ответах клиентам — заполните один раз, и это увидят все агенты."
        title="О компании"
      />

      <div className="flex flex-col gap-4">
        {FIELDS.map((field) => (
          <div className="flex flex-col gap-1.5" key={field.key}>
            <label
              className="text-sm font-medium"
              htmlFor={`company-${field.key}`}
            >
              {field.label}
            </label>
            {field.multiline ? (
              <Textarea
                data-testid={`company-${field.key}`}
                id={`company-${field.key}`}
                onChange={(e) => setField(field.key, e.target.value)}
                rows={3}
                value={form[field.key]}
              />
            ) : (
              <Input
                data-testid={`company-${field.key}`}
                id={`company-${field.key}`}
                onChange={(e) => setField(field.key, e.target.value)}
                value={form[field.key]}
              />
            )}
            <p className="text-sm text-muted-foreground">{field.hint}</p>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <Button
            data-testid="company-save"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(form)}
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </Button>
          {save.isError ? (
            <p className="text-sm text-destructive">
              {save.error instanceof Error
                ? save.error.message
                : "Не удалось сохранить сведения о компании."}
            </p>
          ) : null}
          {!save.isError && !dirty && hasCompanyInfo(form) ? (
            <p className="text-sm text-muted-foreground">Сохранено</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
