#!/bin/sh
# Vercel's "Ignored Build Step" for the artificer project (#1534), run as `sh ignore-build.sh`
# from its Root Directory (artificer/). Vercel caps ignoreCommand at 256 characters, so the path
# list lives here. Exit 0 skips the build; anything else builds.
#
# Only pushes to main deploy this project (vercel.json: git.deploymentEnabled is main only), to stay
# inside the free tier's 100 deployments a day: no previews of other branches. This step then
# skips the build when nothing Artificer changed, which is most pushes to main.
#
# It compares against VERCEL_GIT_PREVIOUS_SHA, the last commit this project deployed, so an
# Artificer change in any commit since then deploys, not just one in the last (HEAD^ if there's
# no previous deploy). Only a
# clean "nothing relevant changed" (git diff --quiet → 0) skips: a git error, such as a SHA missing
# from Vercel's shallow clone, builds.
#
# The paths: the Artificer's own code and page, its build, the dependencies, and what it imports
# or ships from outside src/artificer*: the history engine (storytelling/, since #1540), the
# settlement generator and the Building Forge's data (mapgen/, building-registry.json and
# cultures.json, since #1541), rank-names.ts, and the sprites scripts/build-artificer.mjs copies.
cd .. || exit 1
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- \
  src/artificer src/artificer-app src/artificer-ai artificer.html artificer \
  scripts/build-artificer.mjs package.json package-lock.json \
  storytelling mapgen public/macro-world/building-registry.json macro-world/cultures.json \
  src/rank-names.ts public/assets/sprites/characters || exit 1
