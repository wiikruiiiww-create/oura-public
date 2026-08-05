import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CompanyInfo } from "./companyInfo";
import { fetchCompanyInfo, publishCompanyInfo } from "./companyInfoApi";

export const COMPANY_INFO_QUERY_KEY = "company-info";

/** Текущие сведения о компании; null — если их ещё не заполняли. */
export function useCompanyInfoQuery() {
  return useQuery<CompanyInfo | null>({
    queryKey: [COMPANY_INFO_QUERY_KEY],
    queryFn: fetchCompanyInfo,
    staleTime: 30_000,
  });
}

export function useSaveCompanyInfoMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (info: CompanyInfo) => publishCompanyInfo(info),
    onSuccess: (_data, info) => {
      // relay отдаёт replaceable-событие не мгновенно — показываем сохранённое
      queryClient.setQueryData([COMPANY_INFO_QUERY_KEY], info);
    },
  });
}
