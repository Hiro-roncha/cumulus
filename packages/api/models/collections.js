'use strict';

const { CollectionConfigStore } = require('@cumulus/common');
const Manager = require('./base');
const collectionSchema = require('./schemas').collection;
const Rule = require('./rules');
const { AssociatedRulesError } = require('../lib/errors');

function checkRegex(regex, sampleFileName) {
  const validation = new RegExp(regex);
  const match = validation.test(sampleFileName);

  if (!match) throw new Error(`regex cannot validate ${sampleFileName}`);
}

class Collection extends Manager {
  static recordIsValid(_item, schema = null) {
    const item = _item;
    super.recordIsValid(item, schema);

    // make sure regexes are correct
    // first test granuleId extraction and validation regex
    const extraction = new RegExp(item.granuleIdExtraction);
    const match = item.sampleFileName.match(extraction);

    if (!match) throw new Error('granuleIdExtraction regex returns null when applied to sampleFileName');

    checkRegex(item.granuleId, match[1]);

    // then check all the files
    item.files.forEach((i) => checkRegex(i.regex, i.sampleFileName));
  }

  constructor() {
    super({
      tableName: process.env.CollectionsTable,
      tableHash: { name: 'name', type: 'S' },
      tableRange: { name: 'version', type: 'S' },
      schema: collectionSchema
    });
  }

  /**
   * Check if a given collection exists
   *
   * @param {string} name - collection name
   * @param {string} version - collection version
   * @returns {boolean}
   */
  async exists(name, version) {
    return super.exists({ name, version });
  }

  async create(item) {
    const collectionConfigStore = new CollectionConfigStore(
      process.env.internal,
      process.env.stackName
    );

    let dataType = item.dataType;
    if (!dataType) {
      dataType = item.name;
    }

    await collectionConfigStore.put(dataType, item.version, item);

    return super.create(item);
  }

  /**
   * Delete a collection
   *
   * @param {Object} params
   * @param {string} params.name - the collection name
   * @param {string} params.version - the collection version
   */
  async delete(params = {}) {
    const { name, version } = params;

    const associatedRuleNames = (await this.getAssociatedRules(name, version))
      .map((rule) => rule.name);

    if (associatedRuleNames.length > 0) {
      throw new AssociatedRulesError(
        'Cannot delete a collection that has associated rules',
        associatedRuleNames
      );
    }

    await super.delete({ name, version });
  }

  /**
   * Get any rules associated with the collection
   *
   * @param {string} name - collection name
   * @param {string} version - collection version
   * @returns {Promise<Object>}
   */
  async getAssociatedRules(name, version) {
    const ruleModel = new Rule();

    const scanResult = await ruleModel.scan(
      {
        names: {
          '#c': 'collection',
          '#n': 'name',
          '#v': 'version'
        },
        filter: '#c.#n = :n AND #c.#v = :v',
        values: {
          ':n': name,
          ':v': version
        }
      }
    );

    return scanResult.Items;
  }
}

module.exports = Collection;
