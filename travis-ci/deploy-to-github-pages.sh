#!/bin/sh

set -e

rm -rf website/build
yarn docs-install
yarn docs-build

git clone --depth=50 --branch=gh-pages "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/nasa/cumulus.git" gh-pages
(
  cd gh-pages
  rm -rf *
  rsync -av ../website/build/Cumulus/ .
  git add .
  git commit -m "Automated build in Travis CI"
  git push
)
