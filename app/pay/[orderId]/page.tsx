import PayClient from "./PayClient";

export default async function Page(props: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const shop = typeof searchParams.shop === "string" ? searchParams.shop : "";

  return <PayClient orderId={params.orderId} shop={shop} />;
}
