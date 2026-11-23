export function linkedInConversationUrl(urn:string):string|null {
  const id=urn.match(/,([^(),]+)\)$/)?.[1]??urn.match(/^[A-Za-z0-9_-]+$/)?.[0]??null;
  return id&&/^[A-Za-z0-9_-]+$/.test(id)?`https://www.linkedin.com/messaging/thread/${encodeURIComponent(id)}/`:null;
}
