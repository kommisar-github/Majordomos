'use strict';

/**
 * launchCommand.js — Build the claude spawn argv and env for a given agent.
 *
 * Pure function: no I/O, no side effects. Used by supervisor.js to prepare
 * the arguments passed to node-pty.spawn().
 *
 * Parity target: extension terminals.ts
 *   pty.spawn(claude, ['--model', m, '--agent', `${name}_agent`, `/${name}`],
 *     { cwd, env: { ...process.env, TASK_ROUTER_AGENT, TASK_ROUTER_PROJECT } })
 *
 * ha_devops only: HA_DEVOPS_CAP_TOKEN is injected into the env when opts.capToken
 * is supplied. The raw token lives ONLY in the spawned process env — never logged,
 * never written to disk.
 */

/**
 * @param {string} agentName
 * @param {{
 *   model?:     string,   // model id; falls back to TASK_ROUTER_MODEL or claude-sonnet-4-6
 *   project?:   string,   // project name; falls back to TASK_ROUTER_PROJECT or Majordomos
 *   cwd?:       string,   // working directory; falls back to process.cwd()
 *   claudeBin?: string,   // claude CLI path; falls back to 'claude'
 *   capToken?:  string,   // ha_devops only — injected as HA_DEVOPS_CAP_TOKEN
 * }} opts
 * @returns {{ claudeBin: string, args: string[], env: object, cwd: string }}
 */
function buildLaunchCommand(agentName, opts = {}) {
  const model     = opts.model     || process.env.TASK_ROUTER_MODEL   || 'claude-sonnet-4-6';
  const project   = opts.project   || process.env.TASK_ROUTER_PROJECT || 'Majordomos';
  const cwd       = opts.cwd       || process.cwd();
  const claudeBin = opts.claudeBin || 'claude';

  const args = ['--model', model, '--agent', `${agentName}_agent`, `/${agentName}`];

  const env = {
    ...process.env,
    TASK_ROUTER_AGENT:   agentName,
    TASK_ROUTER_PROJECT: project,
  };

  // ha_devops ONLY: inject cap-token into the pty env.
  // Raw token lives only here — never logged, never on disk.
  if (agentName === 'ha_devops' && opts.capToken) {
    env.HA_DEVOPS_CAP_TOKEN = opts.capToken;
  }

  return { claudeBin, args, env, cwd };
}

module.exports = { buildLaunchCommand };
