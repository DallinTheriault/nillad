import { ChatView } from "./chat-view";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <ChatView initialQ={q ?? ""} />;
}
