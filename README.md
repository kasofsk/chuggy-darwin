# chuggy-darwin

Runs a chuggy worker pool's jobs on a Mac, Apple silicon or Intel. It is being built: today it registers the machine as a pool and runs the pool from a terminal; a launchd agent to keep it running follows. Jobs run as Linux containers through docker in Colima's VM, from the worker core chuggy-linux runs.

It needs Node 24 or later.

## Register

Mint a registration token for the pool in chuggy, then, from a checkout after `npm ci`:

```sh
./cli.mjs register --api <chuggy's origin> --token=<token>
```

Give the token with `=`: a token can begin with `-`, which `--token <token>` would read as an option.

This spends the token, declaring the platform the machine's containers run, `Platform:Linux:Arm64` on Apple silicon or `Platform:Linux:Amd64` on Intel, and writes the pool file chuggy answers with to `~/.config/chuggy/pools/`, named for its tenant, project and pool: `vteng.chuggy.shame.json`. `--api` must be https unless it is this machine's loopback. The secret goes only into the file, mode 600.

The pool takes the hostname's first label unless `--pool <name>` names it; a name is lowercase letters, digits and hyphens. Registering a pool again, from here or any machine, replaces its registration, and chuggy denies the earlier one.

## Run

Colima must be running (`colima start`, whose VM is vz with virtiofs mounts by default; other mount types are untested), with docker's context its unix socket. A job is sized against Colima's VM rather than the Mac, so start Colima with the CPUs and memory the pool's work asks for.

The runner reads `~/Library/Application Support/chuggy-darwin/runner.json`, mode 600:

```json
{
  "claudeTokenFile": "/Users/you/.config/chuggy/claude-token",
  "timeoutSecsMax": 3600,
  "outputBytesMax": 1048576
}
```

`claudeTokenFile` is where `claude setup-token`'s output was saved: mode 600, yours, and under your home, the only directory Colima shares with its VM by default, as named and through any link. `concurrencyMax` (1), `sessionsMax` (2), `environment` and `network` (`chuggy-jobs`) are optional.

```sh
./cli.mjs run --pool ~/.config/chuggy/pools/<file>     # until the plane denies the pool
./cli.mjs once --pool <file>                           # one pass
./cli.mjs status --pool <file>
./cli.mjs stop <assignment> --pool <file>
```

`CHUGGY_DARWIN_POOL` names the pool file where `--pool` does not. `run` exits 0 when the plane denies the pool, since only a new registration brings it back; `once` exits 1 on a denial as on any pass that did not reconcile. Each pool's control socket, pull credentials and env files live in `~/Library/Caches/chuggy-darwin/`, and ended jobs' logs in `~/Library/Logs/chuggy-darwin/`.
