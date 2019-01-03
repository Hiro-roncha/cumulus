# Cumulus Framework

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)
[![npm version](https://badge.fury.io/js/%40cumulus%2Fapi.svg)](https://badge.fury.io/js/%40cumulus%2Fapi)
[![Coverage Status](https://coveralls.io/repos/github/nasa/cumulus/badge.svg?branch=master)](https://coveralls.io/github/nasa/cumulus?branch=master)

## 📖 Documentation:

- Documentation for the latest [released version](https://nasa.github.io/cumulus).
- Documentation for the [unreleased work](https://nasa.github.io/cumulus/docs/next/cumulus-docs-readme).

## More Information

For more information about this project of more about NASA's Earth Observing System Data and Information System (EOSDIS) and its cloud work, please contact [Katie Baynes](mailto:katie.baynes@nasa.gov) or visit us at https://earthdata.nasa.gov.

# 🔨 Development

## Installation

This is for installation for Cumulus development.  See the [Cumulus deployment instructions](https://nasa.github.io/cumulus/docs/deployment/deployment-readme) for instructions on deploying the released Cumulus packages.

### Prerequisites

* [NVM](https://github.com/creationix/nvm) and node version 8.
* [yarn](https://yarnpkg.com/en/)
* [AWS CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
* BASH
* Docker (only required for testing)
* docker-compose (only required for testing `pip install docker-compose`)

Install the correct node version:

```
nvm install
nvm use
```

### Install Lerna

We use Lerna to manage multiple Cumulus packages in the same repo. You need to install lerna as a global module first:

    $ yarn global add lerna

### Install Local Dependencies

We use yarn for local package management

    $ yarn install
    $ yarn ybootstrap

Building All packages:

    $ yarn build

Build and watch packages:

    $ yarn watch

## 📝 Tests

### Unit Tests

#### LocalStack

[LocalStack](https://github.com/localstack/localstack) provides local versions of most AWS services for testing.

The LocalStack repository has [installation instructions](https://github.com/localstack/localstack#installing).

Localstack is included in the docker-compose file. You only need to run the docker-compose command in the next section in order to use it with your tests.

#### Docker containers

Turn on the docker containers first:

    $ docker-compose up local

If you prefer to run docker in detached mode (i.e. run containers in the background), run:

    $ docker-compose up -d local

#### Run tests

Run the test commands next

    $ export LOCALSTACK_HOST=localhost
    $ yarn test

### Integration Tests

For more information please [read this](docs/development/integration-tests.md).

## 🔦 Code Coverage and Quality

For more information please [read this](docs/development/quality-and-coverage.md).

## 📦 Adding New Packages

Create a new folder under `packages` if it is a common library or create folder under `cumulus/tasks` if it is a lambda task. `cd` to the folder and run `npm init`.

Make sure to name the package as `@cumulus/package-name`.

## Running command in all package folders

    $ lerna exec -- rm -rf ./package-lock.json

## Cleaning Up all the repos

    $ yarn clean

##  Contribution

Please refer to: https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md for more information.

## 🛒 Release

To release a new version of cumulus [read this](docs/development/release.md).
