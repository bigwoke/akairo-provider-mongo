const { Provider } = require('discord-akairo');
const { Guild } = require('discord.js');

/**
 * A provider for the discord-akairo framework using the `mongodb` node driver.
 * @extends {Provider}
 */
class MongoDBProvider extends Provider {
  /**
   * @param {MongoClient} mongoClient - MongoDB Client from `mongodb`.
   * @param {string} dbName - Name of database to use.
   */
  constructor (mongoClient, dbName) {
    super();

    /**
     * MongoDB client holding connection to database.
     * @type {MongoClient}
     */
    this.mongoClient = mongoClient;

    /**
     * MongoDB database to store/receive settings.
     */
    this.db = mongoClient.db(dbName);

    /**
     * Akairo client reference.
     * @type {AkairoClient}
     * @readonly
     */
    Object.defineProperty(this, 'akairoClient', { value: null, writable: true });

    /**
     * Client listeners mapped by event name.
     * @type {Map<string, Object>}
     * @private
     */
    this.listeners = new Map();
  }

  /**
   * Initialize connection to database, build cache map, and attach listeners.
   * @return {void}
   */
  async init () {
    const collection = await this.db.collection('settings');

    collection.find().forEach(doc => {
      const guild = doc.guild === 0 ? 'global' : doc.guild;
      this.items.set(guild, doc.settings);

      if (guild === 'global' || this.akairoClient.guilds.has(doc.guild)) {
        this.setupGuild(guild, doc.settings);
      }
    });

    this.listeners
      // TODO: Create listeners for these
      .set('commandPrefixChange', (guild, prefix) => this.set(guild, 'prefix', prefix))
      .set('commandStatusChange', (guild, command, status) => {
        this.set(guild, `cmd-${command.id}`, status);
      })
      .set('categoryStatusChange', (guild, category, status) => {
        this.set(guild, `cat-${category.id}`, status);
      })
      .set('guildCreate', guild => {
        const settings = this.items.get(guild.id);
        if (!settings) return;
        this.setupGuild(guild.id, settings);
      })
      // New command registered
      .set('load', (command, isReload) => {
        if (isReload) return;
        for (const [guild, settings] of this.items) {
          if (guild === 'global' || this.akairoClient.guilds.has(guild)) {
            this.setupGuildCommand(guild, command, settings);
          }
        }
      })
      .set('categoryRegister', category => {
        for (const [guild, settings] of this.items) {
          if (guild === 'global' || this.akairoClient.guilds.has(guild)) {
            this.setupGuildCategory(guild, category, settings);
          }
        }
      });

    for (const [event, listener] of this.listeners) this.akairoClient.on(event, listener);
  }

  /**
   * Gets a value from a specified guild.
   * @param {Guild} guild - Guild to get value for.
   * @param {string} key - The key to get.
   * @param {string} defaultValue - Default value if null or undefined.
   * @return {Object | string} - Setting object or defaultValue string.
   */
  get (guild, key, defaultValue) {
    const guildID = this.getGuildID(guild);
    if (this.items.has(guildID)) {
      const settings = this.items.get(guildID);
      return typeof settings[key] === 'undefined' ? defaultValue : settings[key];
    }
    return defaultValue;
  }

  /**
   * Sets a value for a specified guild.
   * @param {Guild} guild - Guild to set the value for.
   * @param {string} key - The key to set.
   * @param {string} value - The value to set.
   * @return {string} - The value that was set.
   */
  async set (guild, key, value) {
    const guildID = this.getGuildID(guild);
    const settings = this.items.get(guildID) || {};
    settings[key] = value;
    this.items.set(guildID, settings);

    await this.updateGuild(guildID, settings);
    return value;
  }

  /**
   * Deletes a value of a specified guild.
   * @param {Guild} guild - The guild to delete the value of.
   * @param {string} key - The key to delete.
   * @return {string | boolean} - The value that was deleted.
   */
  async delete (guild, key) {
    const guildID = this.getGuildID(guild);
    const settings = this.items.get(guildID) || {};
    const value = settings[key];
    delete settings[key];

    await this.updateGuild(guildID, settings);
    return value;
  }

  /**
   * Clears a guild entry.
   * @param {Guild} guild - Guild to clear.
   * @return {void}
   */
  async clear (guild) {
    this.items.delete(this.getGuildID(guild));
    await this.updateGuild(this.getGuildID(guild), {});
  }

  /**
   * Applies settings to Guild, Command, and Category instances.
   * @param {Guild} guild - Guild to setup.
   * @param {Object} settings - Settings to apply.
   * @return {void}
   */
  setupGuild (guild, settings) {
    if (typeof guild !== 'string') throw new TypeError('Guild must be an ID or "global"');
    guild = this.akairoClient.guilds.get(guild) || null;

    if (typeof settings.prefix !== 'undefined') {
      // If guild exists, set guild prefix. If not, the prefix is global.
      if (guild) guild._commandPrefix = settings.prefix;
      else this.akairoClient._commandPrefix = settings.prefix;
    }

    for (const command of this.akairoClient.commandHandler.modules.values()) {
      this.setupGuildCommand(guild, command, settings);
    }
    for (const category of this.akairoClient.commandHandler.categories.values()) {
      this.setupGuildCategory(guild, category, settings);
    }
  }

  /**
   * Applies settings to Guild or Command instances.
   * @param {Guild} guild - Guild to setup.
   * @param {Command} command - Command to setup.
   * @param {Object} settings - Settings to apply.
   * @return {void}
   */
  setupGuildCommand (guild, command, settings) {
    if (typeof settings[`cmd-${command.id}`] === 'undefined') return;
    if (guild) {
      if (!guild._commandsEnabled) guild._commandsEnabled = {};
      guild._commandsEnabled[command.id] = settings[`cmd-${command.id}`];
    } else {
      if (!command._globalEnabled) command._globalEnabled = true;
      command._globalEnabled = settings[`cmd-${command.id}`];
    }
  }

  /**
   * Applies settings to Guild or Category instances.
   * @param {Guild} guild - Guild to setup.
   * @param {Category} category - Category to setup.
   * @param {Object} settings - Settings to apply.
   * @return {void}
   */
  setupGuildCategory (guild, category, settings) {
    if (typeof settings[`cat-${category.id}`] === 'undefined') return;
    if (guild) {
      if (!guild._categoriesEnabled) guild._categoriesEnabled = {};
      guild._categoriesEnabled[category.id] = settings[`cat-${category.id}`];
    } else {
      if (!category._globalEnabled) category._globalEnabled = true;
      category._globalEnabled = settings[`cat-${category.id}`];
    }
  }

  /**
   * Updates settings of a guild in the database.
   * @param {Guild} guild - Guild to update settings for.
   * @param {Object} settings - Settings to upsert.
   * @return {Object} - Result set of setting update.
   * @private
   */
  async updateGuild (guild, settings) {
    guild = guild === 'global' ? 0 : guild;

    const collection = await this.db.collection('settings');
    return collection.updateOne({ guild }, { $set: { guild, settings } }, { upsert: true });
  }

  /**
   * Returns the ID of a given guild.
   * @param {Guild} guild - Guild to get ID of.
   * @return {number | string} - Guild ID or 'global'.
   * @static
   */
  static getGuildID (guild) {
    if (guild instanceof Guild) return guild.id;
    if (guild === 'global' || guild === null) return 'global';
    if (typeof guild === 'string' && !isNaN(guild)) return guild;
    throw new TypeError('Guild must be a Guild instance, guild ID, "global", or null.');
  }
}

module.exports = MongoDBProvider;
