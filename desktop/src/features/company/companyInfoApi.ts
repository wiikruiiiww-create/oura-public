import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { KIND_READ_STATE } from "@/shared/constants/kinds";

import {
  buildCompanyInfoEventInput,
  COMPANY_INFO_D_TAG,
  type CompanyInfo,
  latestCompanyInfo,
} from "./companyInfo";

/**
 * Чтение и публикация сведений о компании. Событие адресуется d-тегом, а не
 * автором: править описание может любой участник команды, и все они видят одно
 * и то же — берётся самая свежая редакция.
 */

const COMPANY_FETCH_LIMIT = 20;

export async function fetchCompanyInfo(): Promise<CompanyInfo | null> {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_READ_STATE],
    "#d": [COMPANY_INFO_D_TAG],
    limit: COMPANY_FETCH_LIMIT,
  });
  return latestCompanyInfo(events);
}

export async function publishCompanyInfo(info: CompanyInfo): Promise<void> {
  const event = await signRelayEvent(buildCompanyInfoEventInput(info));
  await relayClient.publishEvent(
    event,
    "Не дождались ответа relay при сохранении сведений о компании.",
    "Не удалось сохранить сведения о компании.",
  );
}
