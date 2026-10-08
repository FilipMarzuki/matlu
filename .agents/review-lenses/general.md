# Lens: general (high risk)

This PR touches something with a large blast radius — CI workflows, build
config, agent instructions, backend access, or scripts that spend money — so
look past code style at what it can do when it runs:

- **Workflows**: secrets exposed to untrusted code (`pull_request_target` or
  `workflow_run` checking out or running a PR's head), `${{ }}` expressions
  interpolated into `run:` shell lines from user-controlled fields (titles,
  branch names, comments), permissions wider than needed, triggers that loop
  (a workflow whose result re-triggers itself), jobs that can no longer fail red.
- **Spend**: paid API calls without a budget or cap, without a dry-run path, or
  reachable from forks; retries without backoff; loops whose count comes from data.
- **Build / dependencies**: version ranges loosened, new dependencies with
  install scripts, config changes that drop type-checking or tests from CI.
- **Agent instructions**: rules that contradict each other or existing rules,
  instructions that would let an agent merge, push or delete without a review.
- **Backend**: RLS or policies widened, service keys reaching the browser.
