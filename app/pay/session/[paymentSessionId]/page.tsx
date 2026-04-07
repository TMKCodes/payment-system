import PaySessionClient from "./pay-session-client";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PaySessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentSessionId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { paymentSessionId } = await params;
  const resolvedSearchParams = await searchParams;

  const getFirst = (value: string | string[] | undefined): string | undefined => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value[0];
    return undefined;
  };

  return (
    <PaySessionClient
      paymentSessionId={paymentSessionId}
      amountHtn={getFirst(resolvedSearchParams.amount)}
      orderId={getFirst(resolvedSearchParams.order_id)}
      orderKey={getFirst(resolvedSearchParams.order_key)}
      returnUrl={getFirst(resolvedSearchParams.return_url)}
      callbackUrl={getFirst(resolvedSearchParams.callback_url)}
      label={getFirst(resolvedSearchParams.label)}
    />
  );
}
