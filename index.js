const { Provider } = require('discord-akairo');
const merge = require('merge').recursive;

/**
 * A provider for the discord-akairo framework using the `mongodb` node driver.
 * @param {MongoClient} client - MongoDB Client from `mongodb`.
 * @param {string} dbName - Name of database to use.
 * @param {string} [collName='settings'] - Name of settings collection.
 * @extends {Provider}
 */
class MongoDBProvider extends Provider {
  constructor (client, dbName, collName = 'settings') {
    super();

    /**
     * Reference to MongoDB settings collection.
     * @private
     */
    this.settings = client.db(dbName).collection(collName);
  }

  /**
   * Builds data cache collection from database.
   * @returns {Collection} - Settings cache.
   */
  async init () {
    const data = await this.settings.find();

    data.forEach(doc => {
      this.items.set(doc._id, doc);
    });

    return this.items;
  }

  /**
   * Gets a value from a specified entry.
   * @param {string} id - Entry to get value for.
   * @param {string} key - The key to get.
   * @param {any} [defaultValue] - Default value if null or undefined.
   * @returns {any}
   */
  get (id, key, defaultValue) {
    if (this.items.has(id)) {
      const value = this.items.get(id)[key];
      return value ? value : defaultValue;
    }

    return defaultValue;
  }

  /**
   * Sets a value for a specified entry.
   * @param {string} id - Entry to set the value for.
   * @param {string} key - The key to set.
   * @param {string | Object} value - The value to set.
   * @returns {Promise}
   */
  set (id, key, value) {
    const doc = this.items.get(id) || {};

    // Deep merge existing and new value objects before update.
    if (doc[key] && typeof value !== 'string') value = merge(doc[key], value);
    doc[key] = value;

    this.items.set(id, doc);
    return this.settings.findOneAndUpdate(
      { _id: id },
      { $set: { [key]: value } },
      { upsert: true }
    ).catch(err => {
      throw err;
    });
  }

  /**
   * Deletes a value from a specified entry.
   * @param {string} id - The id of entry delete the value of.
   * @param {string} key - The key to delete.
   * @returns {Promise}
   */
  delete (id, key) {
    const data = this.items.get(id);
    if (!data) throw new Error('No entry in items collection for given ID.');
    delete data[key];

    return this.settings.findOneAndUpdate({ _id: id }, { $unset: { [key]: null } });
  }

  /**
   * Clears an entry.
   * @param {string} id - Entry ID to clear.
   * @returns {Promise}
   */
  clear (id) {
    this.items.delete(id);
    return this.settings.deleteOne({ _id: id });
  }
}

module.exports = MongoDBProvider;
