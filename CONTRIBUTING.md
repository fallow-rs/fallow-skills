# Contributing

## Developer Certificate of Origin

This project uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). With a sign-off, you confirm that you wrote the change or have the right to submit it under the project license.

Add a `Signed-off-by` line to every commit with the `-s` flag:

```bash
git commit -s -m "fix: describe the change"
```

The email in the line must match the commit author. To sign off commits you already made:

```bash
git rebase --signoff origin/main
git push --force-with-lease
```

The `DCO sign-off` check fails a pull request that has a commit without a sign-off. Pull requests from bots are exempt.
