# chuggy-darwin

Runs a chuggy worker pool's jobs on a Mac, Apple silicon or Intel. It is being built: today it registers the machine as a pool, and running the pool's jobs follows. Jobs will run as Linux containers through docker, Colima preferred, from the worker core chuggy-linux runs.

It needs Node 24 or later.

## Register

Mint a registration token for the pool in chuggy, then, from a checkout after `npm ci`:

```sh
./cli.mjs register --api <chuggy's origin> --token=<token>
```

Give the token with `=`: a token can begin with `-`, which `--token <token>` would read as an option.

This spends the token, declaring the platform the machine's containers run, `Platform:Linux:Arm64` on Apple silicon or `Platform:Linux:Amd64` on Intel, and writes the pool file chuggy answers with to `~/.config/chuggy/pools/`, named for its tenant, project and pool: `vteng.chuggy.shame.json`. `--api` must be https unless it is this machine's loopback. The secret goes only into the file, mode 600.

The pool takes the hostname's first label unless `--pool <name>` names it; a name is lowercase letters, digits and hyphens. Registering a pool again, from here or any machine, replaces its registration, and chuggy denies the earlier one.
