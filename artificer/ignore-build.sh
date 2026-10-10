#!/bin/sh
# Vercel's "Ignored Build Step" for the artificer project (#1534), run as `sh ignore-build.sh`
# from its Root Directory (artificer/). Vercel caps ignoreCommand at 256 characters, so the path
# list lives here. Exit 0 skips the build; anything else builds.
#
# Pushes don't deploy this project (vercel.json: git.deploymentEnabled is false), to stay inside
# the free tier's 100 deployments a day: no previews, and no deploy per merge. Production comes
# from a deploy hook once a day, and this step skips that build when nothing Artificer changed.
#
# It compares against VERCEL_GIT_PREVIOUS_SHA, the last commit this project deployed, so an
# Artificer change in any commit since then deploys, not just one in the last (HEAD^ if there's
# no previous deploy). Only a
# clean "nothing relevant changed" (git diff --quiet → 0) skips: a git error, such as a SHA missing
# from Vercel's shallow clone, builds.
#
# The paths: the Artificer's own code and page, its build, the dependencies, and the few files
# outside src/artificer* that it imports or ships (scripts/build-artificer.mjs copies the sprites).
cd .. || exit 1
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- \
  src/artificer src/artificer-app src/artificer-ai artificer.html artificer \
  scripts/build-artificer.mjs package.json package-lock.json \
  src/rank-names.ts public/assets/sprites/characters || exit 1
