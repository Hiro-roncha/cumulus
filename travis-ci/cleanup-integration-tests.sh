#!/bin/sh

set -e

export AWS_ACCESS_KEY_ID="$INTEGRATION_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$INTEGRATION_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$INTEGRATION_AWS_DEFAULT_REGION"

if [ -z "$DEPLOYMENT" ]; then
  DEPLOYMENT=$(node ./travis-ci/select-stack.js)
  if [ "$DEPLOYMENT" = "none" ]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT


# Delete the stack if it's a nightly build
if [ "$DEPLOYMENT" = "cumulus-nightly" ]; then
  cd example || exit 1
  npm install

  echo Delete app deployment

  ./node_modules/.bin/kes cf delete \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --yes

  echo Delete iam deployment

  ./node_modules/.bin/kes cf delete \
    --kes-folder iam \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --yes

  echo Delete app deployment
fi

# Release the stack
KEY="travis-ci-integration-tests/${DEPLOYMENT}.lock"
DATE=$(date -R)
STRING_TO_SIGN_PUT="DELETE


${DATE}
/${CACHE_BUCKET}/${KEY}"
SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_PUT" | openssl sha1 -hmac "$INTEGRATION_AWS_SECRET_ACCESS_KEY" -binary | base64)

curl \
  -sS \
  --fail \
  -X DELETE \
  -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
  -H "Date: ${DATE}" \
  -H "Authorization: AWS ${INTEGRATION_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
  https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}

exit
