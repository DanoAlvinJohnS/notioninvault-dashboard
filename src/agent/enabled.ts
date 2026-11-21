// Pure: decides from data.json whether the AI agents (local server, vault files, Spark) should run.
/** Off for new installs; on for vaults that already have an `agent` setup; an explicit `agentsEnabled` choice always wins. */
export function shouldStartAgents(data: any): boolean {
  if (typeof data?.agentsEnabled === 'boolean') return data.agentsEnabled;
  return data?.agent !== undefined && data?.agent !== null;
}
