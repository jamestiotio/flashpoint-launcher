import { Game } from '@database/entity/Game';
import { GameData } from '@database/entity/GameData';
import { PlatformAlias } from '@database/entity/PlatformAlias';
import { Tag } from '@database/entity/Tag';
import { TagAlias } from '@database/entity/TagAlias';
import { TagCategory } from '@database/entity/TagCategory';
import { LogLevel } from '@shared/Log/interface';
import { MetaEditFile, MetaEditMeta } from '@shared/MetaEdit';
import { deepCopy, downloadFile, padEnd } from '@shared/Util';
import { BackIn, BackInit, BackOut, ComponentState, CurationImageEnum, DownloadDetails, GetRendererLoadedDataResponse } from '@shared/back/types';
import { overwriteConfigData } from '@shared/config/util';
import { CURATIONS_FOLDER_EXPORTED, CURATIONS_FOLDER_TEMP, CURATIONS_FOLDER_WORKING, LOGOS, SCREENSHOTS } from '@shared/constants';
import { convertGameToCurationMetaFile } from '@shared/curate/metaToMeta';
import { LoadedCuration, PlatformAppPathSuggestions } from '@shared/curate/types';
import { getContentFolderByKey, getCurationFolder } from '@shared/curate/util';
import { AppProvider, BrowserApplicationOpts } from '@shared/extensions/interfaces';
import { FilterGameOpts } from '@shared/game/GameFilter';
import { DeepPartial, GamePropSuggestions, ProcessAction, ProcessState } from '@shared/interfaces';
import { PreferencesFile } from '@shared/preferences/PreferencesFile';
import { defaultPreferencesData, overwritePreferenceData } from '@shared/preferences/util';
import { formatString } from '@shared/utils/StringFormatter';
import { TaskProgress } from '@shared/utils/TaskProgress';
import { chunkArray } from '@shared/utils/misc';
import { sanitizeFilename } from '@shared/utils/sanitizeFilename';
import { throttle } from '@shared/utils/throttle';
import * as axiosImport from 'axios';
import * as child_process from 'child_process';
import { execSync } from 'child_process';
import { CurationState, GameMetadataSource, Platform } from 'flashpoint-launcher';
import * as fs from 'fs-extra';
import * as fs_extra from 'fs-extra';
import * as https from 'https';
import { snakeCase, transform } from 'lodash';
import { Progress, add } from 'node-7z';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';
import * as util from 'util';
import * as YAML from 'yaml';
import { ConfigFile } from './ConfigFile';
import { ExtConfigFile } from './ExtConfigFile';
import { GameLaunchInfo, GameLauncher, escapeArgsForShell } from './GameLauncher';
import { ManagedChildProcess } from './ManagedChildProcess';
import { importAllMetaEdits } from './MetaEdit';
import { PlaylistFile } from './PlaylistFile';
import { CONFIG_FILENAME, EXT_CONFIG_FILENAME, PREFERENCES_FILENAME } from './constants';
import { loadCurationIndexImage } from './curate/parse';
import { duplicateCuration, genCurationWarnings, loadCurationFolder, makeCurationFromGame, refreshCurationContent } from './curate/util';
import { saveCuration } from './curate/write';
import { parseAppVar } from './extensions/util';
import * as GameDataManager from './game/GameDataManager';
import * as GameManager from './game/GameManager';
import * as TagManager from './game/TagManager';
import { importCuration, launchAddAppCuration, launchCuration } from './importGame';
import { AppDataSource, loadCurationArchive } from './index';
import { importGames, importPlatforms, importTagCategories, importTags } from './metadataImport';
import { addPlaylistGame, deletePlaylist, deletePlaylistGame, duplicatePlaylist, filterPlaylists, getPlaylistGame, importPlaylist, savePlaylistGame, updatePlaylist } from './playlist';
import { copyFolder, genContentTree } from './rust';
import { getMetaUpdateInfo, syncGames, syncPlatforms, syncTags } from './sync';
import { BackState, BarePlatform, BareTag, MetadataRaw, TagsFile } from './types';
import { pathToBluezip } from './util/Bluezip';
import { pathTo7zBack } from './util/SevenZip';
import { awaitDialog, createNewDialog } from './util/dialog';
import {
  compareSemVerVersions,
  copyError,
  createAddAppFromLegacy,
  createContainer,
  createGameFromLegacy,
  dateToFilenameString,
  deleteCuration,
  exit, getCwd, getTempFilename, openFlashpointManager, optimizeDatabase, pathExists, procToService, promiseSleep, removeService,
  runService
} from './util/misc';
import { uuid } from './util/uuid';

const axios = axiosImport.default;

/**
 * Register all request callbacks to the socket server.
 *
 * @param state State of the back.
 * @param init Initialization function (only runs once per state)
 */
export function registerRequestCallbacks(state: BackState, init: () => Promise<void>): void {
  state.socketServer.register(BackIn.KEEP_ALIVE, () => {});

  state.socketServer.register(BackIn.ADD_LOG, (event, data) => {
    switch (data.logLevel) {
      case LogLevel.TRACE:
        log.trace(data.source, data.content);
        break;
      case LogLevel.DEBUG:
        log.debug(data.source, data.content);
        break;
      case LogLevel.INFO:
        log.info(data.source, data.content);
        break;
      case LogLevel.WARN:
        log.warn(data.source, data.content);
        break;
      case LogLevel.ERROR:
        log.error(data.source, data.content);
        break;
    }
  });

  state.socketServer.register(BackIn.GET_MAIN_INIT_DATA, () => {
    return {
      preferences: state.preferences,
      config: state.config,
    };
  });

  state.socketServer.register(BackIn.GET_LOGGER_INIT_DATA, () => {
    return {
      preferences: state.preferences,
      config: state.config,
      log: state.log
    };
  });

  state.socketServer.register(BackIn.GET_RENDERER_EXTENSION_INFO, async () => {
    return {
      devScripts: await state.extensionsService.getContributions('devScripts'),
      contextButtons: await state.extensionsService.getContributions('contextButtons'),
      curationTemplates: await state.extensionsService.getContributions('curationTemplates'),
      extConfigs: await state.extensionsService.getContributions('configuration'),
      extConfig: state.extConfig,
      extensions: (await state.extensionsService.getExtensions()).map(e => {
        return {
          id: e.id,
          ...e.manifest
        };
      }),
    };
  });

  state.socketServer.register(BackIn.CANCEL_DOWNLOAD, async () => {
    state.downloadController.abort();
  });

  state.socketServer.register(BackIn.GET_RENDERER_LOADED_DATA, async () => {
    const libraries = await GameManager.findUniqueValues(Game, 'library');

    // Fetch update feed
    let updateFeedMarkdown = '';
    if (state.preferences.updateFeedUrl) {
      updateFeedMarkdown = await axios.get(state.preferences.updateFeedUrl, { timeout: 3000 })
      .then((res) => {
        return res.data;
      })
      .catch((err) => {
        log.debug('Launcher', `Failed to fetch news feed from ${state.preferences.updateFeedUrl}, ERROR: ${err}`);
        return '';
      });
    } else {
      log.debug('Launcher', 'No Update Feed URL specified');
    }

    // Fetch GOTD file
    const gotdUrl = state.config.gotdUrl;
    const gotdPath = path.join(state.config.flashpointPath, 'Data', 'gotd.json');
    await new Promise((resolve, reject) => {
      const thumbnailWriter = fs.createWriteStream(gotdPath);
      axios.get(gotdUrl, { responseType: 'stream' })
      .then((res) => {
        res.data.pipe(thumbnailWriter);
        thumbnailWriter.on('close', resolve);
        thumbnailWriter.on('error', (err) => {
          thumbnailWriter.close();
          reject(err);
        });
      })
      .catch((err) => {
        reject(err);
      });
    })
    .catch(() => {
      log.error('Launcher', 'Failed to download gotd list from ' + gotdUrl);
    });

    let gotdList = [];
    try {
      gotdList = JSON.parse(fs.readFileSync(gotdPath, { encoding: 'utf8' })).games || [];
      gotdList = gotdList.filter((g: any) => g.id !== '');
    } catch {
      /** Ignore */
    }

    state.platformAppPaths = await GameManager.findPlatformsAppPaths();

    const res: GetRendererLoadedDataResponse = {
      gotdList: gotdList,
      libraries: libraries,
      services: Array.from(state.services.values()).map(s => procToService(s)),
      serverNames: state.serviceInfo ? state.serviceInfo.server.map(i => i.name || '') : [],
      tagCategories: await TagManager.findTagCategories(),
      suggestions: state.suggestions,
      platformAppPaths: state.platformAppPaths,
      logoSets: Array.from(state.registry.logoSets.values()),
      updateFeedMarkdown,
      mad4fpEnabled: state.serviceInfo ? (state.serviceInfo.server.findIndex(s => s.mad4fp === true) !== -1) : false,
      componentStatuses: state.componentStatuses,
    };

    // Fire after return has sent
    setTimeout(() => state.apiEmitters.onDidConnect.fire(), 100);

    return res;
  });

  state.socketServer.register(BackIn.PRE_UPDATE_INFO, async (event, source: GameMetadataSource) => {
    let totalGames = 0;
    try {
      totalGames = await GameManager.countGames();
    } catch {/** ignore, errors if 0 count */}
    if (totalGames === 0) {
      return getMetaUpdateInfo(source, false, true);
    } else {
      return getMetaUpdateInfo(source);
    }
  });

  state.socketServer.register(BackIn.GET_RENDERER_INIT_DATA, async () => {
    state.languageContainer = createContainer(
      state.languages,
      state.preferences.currentLanguage,
      state.localeCode,
      state.preferences.fallbackLanguage
    );

    return {
      preferences: state.preferences,
      config: state.config,
      fileServerPort: state.fileServerPort,
      log: state.log,
      customVersion: state.customVersion,
      languages: state.languages,
      language: state.languageContainer,
      themes: Array.from(state.registry.themes.values()),
      localeCode: state.localeCode,
    };

  });

  state.socketServer.register(BackIn.SYNC_TAGGED, async (event, source) => {
    const openDialog = state.socketServer.showMessageBoxBack(state, event.client);
    const dialogId = await openDialog({
      largeMessage: true,
      message: `Updating tags from ${source.name}...`,
      buttons: []
    });
    const newDate = new Date();
    const categories = await TagManager.findTagCategories();
    return AppDataSource.transaction(async (tx) => {
      const lastDatePlats = await syncPlatforms(tx, source);
      const lastDateTags = await syncTags(tx, source, categories);
      if (lastDatePlats > lastDateTags) {
        return lastDatePlats;
      } else {
        return lastDateTags;
      }
    })
    .then((lastDate) => {
      /** Success */
      const sourceIdx = state.preferences.gameMetadataSources.findIndex(s => s.name === source.name);
      if (sourceIdx !== -1) {
        state.preferences.gameMetadataSources[sourceIdx].tags.latestUpdateTime = lastDate.toISOString();
        state.preferences.gameMetadataSources[sourceIdx].tags.actualUpdateTime = newDate.toISOString();
        state.prefsQueue.push(() => {
          PreferencesFile.saveFile(path.join(state.config.flashpointPath, PREFERENCES_FILENAME), state.preferences, state);
        });
      }
    })
    .finally(() => {
      state.socketServer.broadcast(BackOut.CANCEL_DIALOG, dialogId);
    });
  });

  state.socketServer.register(BackIn.SYNC_ALL, async (event, source) => {
    if (!state.isDev) {
      // Make sure we meet minimum verison requirements
      const updatesReady = state.componentStatuses.filter(c => c.id === 'core-launcher' && c.state === ComponentState.NEEDS_UPDATE).length > 0;
      const version = state.version;
      const versionUrl = `${source.baseUrl}/api/min-launcher`;
      const res = await axios.get(versionUrl)
      .catch((err) => { throw `Failed to find minimum launcher version requirement from metadata server.\n${err}`; });
      if (compareSemVerVersions(version, res.data['min-version'] || '9999999999999') < 0) {
        if (!updatesReady) {
          // No software update ready but metadata server requires it
          const openDialog = state.socketServer.showMessageBoxBack(state, event.client);
          await openDialog({
            largeMessage: true,
            message: state.languageContainer.app.noLauncherUpdateReady,
            buttons: [state.languageContainer.misc.ok]
          });
          return false;
        }
        // Too old to sync metadata, prompt a software update
        const openDialog = state.socketServer.showMessageBoxBack(state, event.client);
        const dialogId = await openDialog({
          largeMessage: true,
          message: state.languageContainer.app.softwareUpdateRequired,
          buttons: [state.languageContainer.misc.yes, state.languageContainer.misc.no],
          cancelId: 1
        });
        const button = (await awaitDialog(state, dialogId)).buttonIdx;
        if (button !== 0) {
          log.info('Launcher', 'User aborted metadata update: Refused required software update.');
          return false;
        } else {
          openFlashpointManager(state);
          return false;
        }
      }
    }

    const newDate = new Date();
    const categories = await TagManager.findTagCategories();
    let totalGames = 0;
    try {
      totalGames = await GameManager.countGames();
    } catch {/** ignore, errors on 0 count */}
    // Always do a full sync if empty DB
    if (totalGames === 0) {
      source.games = {
        actualUpdateTime: source.games.actualUpdateTime,
        latestDeleteTime: source.games.latestDeleteTime,
        latestUpdateTime: '1970-01-01'
      };
      source.tags = {
        actualUpdateTime: source.games.actualUpdateTime,
        latestDeleteTime: source.games.latestDeleteTime,
        latestUpdateTime: '1970-01-01'
      };
    }

    // Fetch pre-update info to estimate progress bar size
    const total = await getMetaUpdateInfo(source, true, totalGames === 0);
    const chunks = Math.ceil(total / 2500);

    const openDialog = state.socketServer.showMessageBoxBack(state, event.client);
    const dialogId = await openDialog({
      largeMessage: true,
      message: `Syncing metadata from ${source.name}...`,
      buttons: [],
      fields: [
        {
          type: 'progress',
          name: 'progress',
          message: `${total} Updates...`,
          value: 0
        }
      ]
    });

    return AppDataSource.transaction(async (tx) => {
      console.log('plats');
      const lastDatePlats = await syncPlatforms(tx, source);
      console.log('tags');
      const lastDateTags = await syncTags(tx, source, categories);
      if (lastDatePlats < lastDateTags) {
        return lastDateTags;
      } else {
        return lastDatePlats;
      }
    })
    .then((lastDate) => {
      /** Tags Success */
      const sourceIdx = state.preferences.gameMetadataSources.findIndex(s => s.name === source.name);
      if (sourceIdx !== -1) {
        state.preferences.gameMetadataSources[sourceIdx].tags.latestUpdateTime = lastDate.toISOString();
        state.preferences.gameMetadataSources[sourceIdx].tags.actualUpdateTime = newDate.toISOString();
        state.prefsQueue.push(() => {
          PreferencesFile.saveFile(path.join(state.config.flashpointPath, PREFERENCES_FILENAME), state.preferences, state);
        });
      }
    })
    .then(() => {
      console.log('games');
      // Open new transaction for games
      const dataPacksFolder = path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath);
      let chunk = 0;
      return AppDataSource.transaction(async (tx) => {
        return await syncGames(tx, source, dataPacksFolder, () => {
          chunk = chunk + 1;
          const progress = chunk / chunks;
          state.socketServer.broadcast(BackOut.UPDATE_DIALOG_FIELD_VALUE, dialogId, 'progress', progress * 100);
        });
      });
    })
    .then((lastDate) => {
      console.log(lastDate.toISOString());
      /** Games Success */
      const sourceIdx = state.preferences.gameMetadataSources.findIndex(s => s.name === source.name);
      if (sourceIdx !== -1) {
        state.preferences.gameMetadataSources[sourceIdx].games.latestUpdateTime = lastDate.toISOString();
        state.preferences.gameMetadataSources[sourceIdx].games.actualUpdateTime = newDate.toISOString();
        state.prefsQueue.push(() => {
          PreferencesFile.saveFile(path.join(state.config.flashpointPath, PREFERENCES_FILENAME), state.preferences, state);
        });
        state.socketServer.broadcast(BackOut.UPDATE_PREFERENCES_RESPONSE, state.preferences);
      }
    })
    .then(async () => {
      // Send out new suggestions and library lists
      state.suggestions = {
        tags: await GameManager.findUniqueValues(TagAlias, 'name'),
        playMode: await GameManager.findUniqueValues(Game, 'playMode', true),
        platforms: await GameManager.findUniqueValues(PlatformAlias, 'name'),
        status: await GameManager.findUniqueValues(Game, 'status', true),
        applicationPath: await GameManager.findUniqueApplicationPaths(),
        library: await GameManager.findUniqueValues(Game, 'library'),
      };
      const appPaths: PlatformAppPathSuggestions = await GameManager.findPlatformsAppPaths();
      state.platformAppPaths = appPaths; // Update cache
      const total = await GameManager.countGames();
      state.socketServer.broadcast(BackOut.POST_SYNC_CHANGES, state.suggestions.library, state.suggestions, state.platformAppPaths, total);
      return true;
    })
    .finally(() => {
      state.socketServer.broadcast(BackOut.CANCEL_DIALOG, dialogId);
    });
  });

  state.socketServer.register(BackIn.INIT_LISTEN, (event) => {
    const done: BackInit[] = [];
    for (const key in state.init) {
      const init: BackInit = key as any;
      if (state.init[init]) {
        done.push(init);
      } else {
        state.initEmitter.once(init, () => {
          state.socketServer.send(event.client, BackOut.INIT_EVENT, { done: [ init ] });
        });
      }
    }

    if (!state.runInit) {
      state.runInit = true;
      init();
    }

    return { done };
  });

  state.socketServer.register(BackIn.GET_SUGGESTIONS, async () => {
    const suggestions: GamePropSuggestions = {
      tags: await GameManager.findUniqueValues(TagAlias, 'name'),
      playMode: await GameManager.findUniqueValues(Game, 'playMode', true),
      platforms: await GameManager.findUniqueValues(PlatformAlias, 'name'),
      status: await GameManager.findUniqueValues(Game, 'status', true),
      applicationPath: await GameManager.findUniqueApplicationPaths(),
      library: await GameManager.findUniqueValues(Game, 'library'),
    };
    const appPaths: PlatformAppPathSuggestions = await GameManager.findPlatformsAppPaths();
    state.platformAppPaths = appPaths; // Update cache
    return {
      suggestions: suggestions,
      platformAppPaths: appPaths,
    };
  });

  state.socketServer.register(BackIn.GET_GAMES_TOTAL, async () => {
    return await GameManager.countGames();
  });

  state.socketServer.register(BackIn.SET_LOCALE, (event, data) => {
    state.localeCode = data;

    // @TODO Update the language container if the locale changes

    return data;
  });

  state.socketServer.register(BackIn.GET_EXEC, () => {
    return state.execMappings;
  });

  state.socketServer.register(BackIn.LAUNCH_ADDAPP, async (event, id) => {
    const addApp = await GameManager.findAddApp(id);
    if (addApp) {
      // Force load relation
      addApp.parentGame = await GameManager.findGame(addApp.parentGameId) as Game;
      // If it has GameData, make sure it's present
      let gameData: GameData | null;
      if (addApp.parentGame.activeDataId) {
        gameData = await GameDataManager.findOne(addApp.parentGame.activeDataId);
        if (gameData && !gameData.presentOnDisk) {
          // Download GameData
          try {
            await downloadGameData(state, gameData);
          } catch (error: any) {
            state.socketServer.broadcast(BackOut.OPEN_ALERT, error);
            log.info('Game Launcher', `Add App Launch Aborted: ${error}`);
            return;
          }
        }
      }
      await state.apiEmitters.games.onWillLaunchAddApp.fireAlert(state, addApp, event.client, 'Error during add app launch api event');
      const platforms = addApp.parentGame ? addApp.parentGame.platforms.map(p => p.primaryAlias.name): [];
      await GameLauncher.launchAdditionalApplication({
        addApp,
        changeServer: changeServerFactory(state),
        fpPath: path.resolve(state.config.flashpointPath),
        htdocsPath: state.preferences.htdocsFolderPath,
        dataPacksFolderPath: state.preferences.dataPacksFolderPath,
        sevenZipPath: state.sevenZipPath,
        native: addApp.parentGame && state.preferences.nativePlatforms.some(p => platforms.includes(p)) || false,
        execMappings: state.execMappings,
        lang: state.languageContainer,
        isDev: state.isDev,
        exePath: state.exePath,
        appPathOverrides: state.preferences.appPathOverrides,
        providers: await getProviders(state),
        proxy: state.preferences.browserModeProxy,
        openDialog: state.socketServer.showMessageBoxBack(state, event.client),
        openExternal: state.socketServer.openExternal(event.client),
        runGame: runGameFactory(state),
        envPATH: state.pathVar,
        state,
      }, false);
      state.apiEmitters.games.onDidLaunchAddApp.fireAlert(state, addApp, event.client, 'Error during post add app launch api event');
    }
  });

  state.socketServer.register(BackIn.LAUNCH_GAME, async (event, id) => {
    const game = await GameManager.findGame(id);

    if (game) {
      // Make sure Server is set to configured server - Curations may have changed it
      const configServer = state.serviceInfo ? state.serviceInfo.server.find(s => s.name === state.preferences.server) : undefined;
      if (configServer) {
        const server = state.services.get('server');
        if (!server || !('name' in server.info) || server.info.name !== configServer.name) {
          // Server is different, change now
          if (server) { await removeService(state, 'server'); }
          runService(state, 'server', 'Server', state.config.flashpointPath, {env: {
            ...process.env,
            'PATH': state.pathVar ?? process.env.PATH,
          }}, configServer);
        }
      }
      // If it has GameData, make sure it's present
      let gameData: GameData | null;
      if (game.activeDataId) {
        log.debug('Launcher', 'Found active game data');
        gameData = await GameDataManager.findOne(game.activeDataId);
        if (gameData && !gameData.presentOnDisk) {
          // Download GameData
          try {
            await downloadGameData(state, gameData);
          } catch (error: any) {
            state.socketServer.broadcast(BackOut.OPEN_ALERT, error);
            log.info('Game Launcher', `Game Launch Aborted: ${error}`);
            return;
          }
        }
      }
      // Launch game
      const flatGamePlatforms = makeFlatPlatforms(game.platforms);
      await GameLauncher.launchGame({
        game,
        fpPath: path.resolve(state.config.flashpointPath),
        htdocsPath: state.preferences.htdocsFolderPath,
        dataPacksFolderPath: state.preferences.dataPacksFolderPath,
        sevenZipPath: state.sevenZipPath,
        native: state.preferences.nativePlatforms.some(p => flatGamePlatforms.includes(p)),
        execMappings: state.execMappings,
        lang: state.languageContainer,
        isDev: state.isDev,
        exePath: state.exePath,
        appPathOverrides: state.preferences.appPathOverrides,
        providers: await getProviders(state),
        proxy: state.preferences.browserModeProxy,
        openDialog: state.socketServer.showMessageBoxBack(state, event.client),
        openExternal: state.socketServer.openExternal(event.client),
        runGame: runGameFactory(state),
        envPATH: state.pathVar,
        changeServer: changeServerFactory(state),
        state,
      },
      state.apiEmitters.games.onWillLaunchGame.fireableFactory(state, event.client, 'Error during game launch api event'), false);
      await state.apiEmitters.games.onDidLaunchGame.fireAlert(state, game, event.client, 'Error from post game launch api event');
    }
  });

  state.socketServer.register(BackIn.SAVE_GAMES, async (event, data) => {
    await GameManager.updateGames(data);
  });

  state.socketServer.register(BackIn.SAVE_GAME, async (event, data) => {
    try {
      const game = await GameManager.save(data);
      state.queries = {}; // Clear entire cache
      return {
        game,
        library: game.library,
        gamesTotal: await GameManager.countGames(),
      };
    } catch (err) {
      console.error(err);
      throw err;
    }
  });

  state.socketServer.register(BackIn.DELETE_GAME, async (event, id) => {
    const game = await GameManager.removeGameAndAddApps(id,
      path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath),
      path.join(state.config.flashpointPath, state.preferences.imageFolderPath),
      path.join(state.config.flashpointPath, state.preferences.htdocsFolderPath));

    state.queries = {}; // Clear entire cache

    return {
      game,
      library: game ? game.library : undefined,
      gamesTotal: await GameManager.countGames(),
    };
  });

  state.socketServer.register(BackIn.DUPLICATE_GAME, async (event, id, dupeImages) => {
    const game = await GameManager.findGame(id);
    let result: Game | undefined;
    if (game) {

      // Copy and apply new IDs
      const newGame = deepCopy(game);
      const newAddApps = game.addApps.map(addApp => deepCopy(addApp));
      newGame.id = uuid();
      for (let j = 0; j < newAddApps.length; j++) {
        newAddApps[j].id = uuid();
        newAddApps[j].parentGame = newGame;
      }
      newGame.addApps = newAddApps;

      // Add copies
      result = await GameManager.save(newGame);

      // Copy images
      if (dupeImages) {
        const imageFolder = path.join(state.config.flashpointPath, state.preferences.imageFolderPath);
        const oldLast = path.join(game.id.substring(0, 2), game.id.substring(2, 4), game.id+'.png');
        const newLast = path.join(newGame.id.substring(0, 2), newGame.id.substring(2, 4), newGame.id+'.png');

        const oldLogoPath = path.join(imageFolder, LOGOS, oldLast);
        const newLogoPath = path.join(imageFolder, LOGOS, newLast);
        try {
          if (await pathExists(oldLogoPath)) {
            await fs.promises.mkdir(path.dirname(newLogoPath), { recursive: true });
            await fs.promises.copyFile(oldLogoPath, newLogoPath);
          }
        } catch (e) { console.error(e); }

        const oldScreenshotPath = path.join(imageFolder, SCREENSHOTS, oldLast);
        const newScreenshotPath = path.join(imageFolder, SCREENSHOTS, newLast);
        try {
          if (await pathExists(oldScreenshotPath)) {
            await fs.promises.mkdir(path.dirname(newScreenshotPath), { recursive: true });
            await fs.promises.copyFile(oldScreenshotPath, newScreenshotPath);
          }
        } catch (e) { console.error(e); }
      }

      state.queries = {}; // Clear entire cache
    }

    return {
      game: null,
      library: result ? result.library : undefined,
      gamesTotal: await GameManager.countGames(),
    };
  });

  state.socketServer.register(BackIn.DUPLICATE_PLAYLIST, async (event, playlistId) => {
    await duplicatePlaylist(state, playlistId);
  });

  state.socketServer.register(BackIn.IMPORT_PLAYLIST, async (event, filePath, library) => {
    return importPlaylist(state, filePath, library, event);
  });

  state.socketServer.register(BackIn.EXPORT_GAME, async (event, id, location, metaOnly) => {
    if (await pathExists(metaOnly ? path.dirname(location) : location)) {
      const game = await GameManager.findGame(id);
      if (game) {
        // Save to file
        try {
          await fs.promises.writeFile(
            metaOnly ? location : path.join(location, 'meta.yaml'),
            YAML.stringify(convertGameToCurationMetaFile(game, await TagManager.findTagCategories())));
        } catch (e) { console.error(e); }

        // Copy images
        if (!metaOnly) {
          const imageFolder = path.join(state.config.flashpointPath, state.preferences.imageFolderPath);
          const last = path.join(game.id.substring(0, 2), game.id.substring(2, 4), game.id+'.png');

          const oldLogoPath = path.join(imageFolder, LOGOS, last);
          const newLogoPath = path.join(location, 'logo.png');
          try {
            if (await pathExists(oldLogoPath)) { await fs.promises.copyFile(oldLogoPath, newLogoPath); }
          } catch (e) { console.error(e); }

          const oldScreenshotPath = path.join(imageFolder, SCREENSHOTS, last);
          const newScreenshotPath = path.join(location, 'ss.png');
          try {
            if (await pathExists(oldScreenshotPath)) { await fs.promises.copyFile(oldScreenshotPath, newScreenshotPath); }
          } catch (e) { console.error(e); }
        }
      }
    }
  });

  state.socketServer.register(BackIn.GET_GAME, async (event, id) => {
    return GameManager.findGame(id);
  });

  state.socketServer.register(BackIn.GET_GAME_DATA, async (event, id) => {
    const gameData = await GameDataManager.findOne(id);
    // Verify it's still on disk
    if (gameData && gameData.presentOnDisk && gameData.path) {
      try {
        await fs.promises.access(path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath, gameData.path), fs.constants.F_OK);
      } catch (err) {
        gameData.path = undefined;
        gameData.presentOnDisk = false;
        return await GameDataManager.save(gameData);
      }
    }
    return gameData;
  });

  state.socketServer.register(BackIn.GET_GAMES_GAME_DATA, async (event, id) => {
    return GameDataManager.findGameData(id);
  });

  state.socketServer.register(BackIn.SAVE_GAME_DATAS, async (event, data) => {
    // Ignore presentOnDisk, client isn't the most aware
    await Promise.all(data.map(async (d) => {
      const existingData = await GameDataManager.findOne(d.id);
      if (existingData) {
        existingData.title = d.title;
        existingData.parameters = d.parameters;
        return GameDataManager.save(existingData);
      }
    }));
  });

  state.socketServer.register(BackIn.DELETE_GAME_DATA, async (event, gameDataId) => {
    const gameData = await GameDataManager.findOne(gameDataId);
    if (gameData) {
      if (gameData.presentOnDisk && gameData.path) {
        await GameDataManager.onWillUninstallGameData.fire(gameData);
        const gameDataPath = path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath, gameData.path);
        await fs.promises.unlink(gameDataPath);
        gameData.path = undefined;
        gameData.presentOnDisk = false;
        GameDataManager.onDidUninstallGameData.fire(gameData);
      }
      const game = await GameManager.findGame(gameData.gameId);
      if (game) {
        game.activeDataId = undefined;
        game.activeDataOnDisk = false;
        await GameManager.save(game);
      }
      await GameDataManager.remove(gameDataId);
    }
  });

  state.socketServer.register(BackIn.IMPORT_GAME_DATA, async (event, gameId, filePath) => {
    return GameDataManager.importGameData(gameId, filePath, path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath));
  });

  state.socketServer.register(BackIn.DOWNLOAD_GAME_DATA, async (event, gameDataId) => {
    const gameData = await GameDataManager.findOne(gameDataId);
    if (gameData) {
      await downloadGameData(state, gameData)
      .catch((err) => {
        throw 'Failed to download';
      });
    } else {
      log.error('Launcher', `Game Data not found (ID=${gameDataId})`);
      throw new Error(`Game Data not found (ID=${gameDataId})`);
    }
  });

  state.socketServer.register(BackIn.UNINSTALL_GAME_DATA, async (event, id) => {
    const gameData: GameData | null = await GameDataManager.findOne(id);
    if (gameData && gameData.path && gameData.presentOnDisk) {
      await GameDataManager.onWillUninstallGameData.fire(gameData);
      // Delete Game Data
      const gameDataPath = path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath, gameData.path);
      await fs.promises.unlink(gameDataPath)
      .catch((error) => {
        if (error.code !== 'ENOENT') {
          log.error('Launcher', `Error Deleting Game: ${error}`);
          throw error;
        }
      });
      gameData.path = '';
      gameData.presentOnDisk = false;
      await GameDataManager.save(gameData);
      GameDataManager.onDidUninstallGameData.fire(gameData);
      // Update Game
      const game = await GameManager.findGame(gameData.gameId);
      if (game && game.activeDataId === gameData.id) {
        game.activeDataOnDisk = false;
        return GameManager.save(game);
      }
    }
    return null;
  });

  state.socketServer.register(BackIn.GET_SOURCES, async () => {
    return state.preferences.gameDataSources;
  });

  state.socketServer.register(BackIn.GET_ALL_GAMES, async (event, startFrom) => {
    return GameManager.findAllGames(startFrom);
  });

  state.socketServer.register(BackIn.UPDATE_TAGGED_FIELDS, async () => {
    await AppDataSource.query(`
    UPDATE game 
    SET platformsStr = (
      SELECT GROUP_CONCAT(
        (SELECT name FROM platform_alias WHERE platformId = p.platformId), '; '
      ) 
      FROM game_platforms_platform p 
      WHERE p.gameId = game.id
    )`);
    await AppDataSource.query(`
    UPDATE game 
    SET tagsStr = (
      SELECT IFNULL(tags, "") tags FROM (
        SELECT GROUP_CONCAT(
          (SELECT name FROM tag_alias WHERE tagId = t.tagId), '; '
        ) tags
        FROM game_tags_tag t
        WHERE t.gameId = game.id
      )
    )`);
  });

  state.socketServer.register(BackIn.RANDOM_GAMES, async (event, data) => {
    const flatFilters = data.tagFilters ? data.tagFilters.reduce<string[]>((prev, cur) => prev.concat(cur.tags),  []) : [];
    return await GameManager.findRandomGames(data.count, data.broken, data.excludedLibraries, flatFilters);
  });

  state.socketServer.register(BackIn.BROWSE_VIEW_KEYSET, async (event, library, query) => {
    query.filter = adjustGameFilter(query.filter);
    const startTime = Date.now();
    const result = await GameManager.findGamePageKeyset(query.filter, query.orderBy, query.orderReverse, query.searchLimit);
    log.debug('Launcher', 'Search Time: ' + (Date.now() - startTime) + 'ms');
    return {
      keyset: result.keyset,
      total: result.total,
    };
  });

  state.socketServer.register(BackIn.BROWSE_VIEW_PAGE, async (event, data) => {
    data.query.filter = adjustGameFilter(data.query.filter);
    const results = await GameManager.findGames({
      ranges: data.ranges,
      filter: data.query.filter,
      orderBy: data.query.orderBy,
      direction: data.query.orderReverse,
    }, !!data.shallow);

    return {
      ranges: results,
      library: data.library,
    };
  });

  state.socketServer.register(BackIn.DELETE_TAG_CATEGORY, async (event, data) => {
    const result = await TagManager.deleteTagCategory(data, state.socketServer.showMessageBoxBack(state, event.client), state);
    state.socketServer.send(event.client, BackOut.DELETE_TAG_CATEGORY, result);
    await TagManager.sendTagCategories(state.socketServer);
    return result;
  });

  state.socketServer.register(BackIn.GET_TAG_CATEGORY_BY_ID, async (event, data) => {
    const result = await TagManager.getTagCategoryById(data);
    state.socketServer.send(event.client, BackOut.GET_TAG_CATEGORY_BY_ID, result);
    return result;
  });

  state.socketServer.register(BackIn.SAVE_TAG_CATEGORY, async (event, data) => {
    const result = await TagManager.saveTagCategory(data);
    state.socketServer.send(event.client, BackOut.SAVE_TAG_CATEGORY, result);
    await TagManager.sendTagCategories(state.socketServer);
    return result;
  });

  state.socketServer.register(BackIn.GET_TAG_BY_ID, async (event, data) => {
    const tag = await TagManager.getTagById(data);
    state.socketServer.send(event.client, BackOut.GET_TAG_BY_ID, tag);
    return tag;
  });

  state.socketServer.register(BackIn.GET_PLATFORM_BY_ID, async (event, data) => {
    const platform = await TagManager.getPlatformById(data);
    return platform;
  });

  state.socketServer.register(BackIn.GET_TAGS, async (event, name, tagFilters) => {
    const flatFilters: string[] = tagFilters ? tagFilters.reduce<string[]>((prev, cur) => prev.concat(cur.tags), []) : [];
    const tags = await TagManager.findTags(name, flatFilters);
    state.socketServer.send(event.client, BackOut.GET_TAGS, tags);
    return tags;
  });

  state.socketServer.register(BackIn.MERGE_TAGS, async (event, data) => {
    const newTag = await TagManager.mergeTags(data, state.socketServer.showMessageBoxBack(state, event.client), state) as Tag; // @TYPESAFE fix this?
    state.socketServer.send(event.client, BackOut.MERGE_TAGS, newTag);
    return newTag;
  });

  state.socketServer.register(BackIn.CLEANUP_TAGS, async (event) => {
    const allTags = await TagManager.findTags();
    const commaTags = allTags.filter(t => t.primaryAlias.name.includes(','));
    for (const oldTag of commaTags) {
      const allAliases = oldTag.primaryAlias.name.split(',').map(a => a.trim());
      const tagsToAdd: Tag[] = [];
      for (const alias of allAliases) {
        let tag = await TagManager.findTag(alias);
        if (!tag) {
          // Tag doesn't exist, make a new one
          tag = await TagManager.createTag(alias);
        }
        // Add tag to list if unique
        if (tag) {
          if (tagsToAdd.findIndex(t => tag && tag.id == t.id) == -1) {
            tagsToAdd.push(tag);
          }
        }
      }
      // Edit each game with this tag
      const gamesToEdit = await GameManager.findGamesWithTag(oldTag);
      for (let i = 0; i < gamesToEdit.length; i++) {
        const game = gamesToEdit[i];
        // Remove old tag
        const oldTagIndex = game.tags.findIndex(t => t.id == oldTag.id);
        if (oldTagIndex > -1) {
          game.tags.splice(oldTagIndex, 1);
        }
        // Add new tags
        for (const newTag of tagsToAdd) {
          if (game.tags.findIndex(t => t.id == newTag.id) == -1) {
            game.tags.push(newTag);
          }
        }
        gamesToEdit[i] = game;
      }
      // Save all games
      await GameManager.updateGames(gamesToEdit);
      // Remove old tag
      if (oldTag.id) {
        await TagManager.deleteTag(oldTag.id, state, state.socketServer.showMessageBoxBack(state, event.client));
      }
    }
  });

  state.socketServer.register(BackIn.DELETE_TAG, async (event, data) => {
    const success = await TagManager.deleteTag(data, state, state.socketServer.showMessageBoxBack(state, event.client));
    return {
      success: success,
      id: data,
    };
  });

  state.socketServer.register(BackIn.SAVE_TAG, async (event, data) => {
    const result = await TagManager.saveTag(data);
    state.socketServer.send(event.client, BackOut.SAVE_TAG, result);
    return result;
  });

  state.socketServer.register(BackIn.SAVE_TAG_ALIAS, async (event, data) => {
    return TagManager.saveTagAlias(data);
  });

  state.socketServer.register(BackIn.GET_TAG_SUGGESTIONS, async (event, text, tagFilters) => {
    const flatTagFilter = tagFilters.reduce<string[]>((prev, cur) => prev.concat(cur.tags), []);
    const flatCatFilter = tagFilters.reduce<string[]>((prev, cur) => prev.concat(cur.categories), []);
    const result = await TagManager.findTagSuggestions(text, flatTagFilter, flatCatFilter);
    state.socketServer.send(event.client, BackOut.GET_TAG_SUGGESTIONS, result);
    return result;
  });

  state.socketServer.register(BackIn.GET_PLATFORM_SUGGESTIONS, async (event, text) => {
    const result = await TagManager.findPlatformSuggestions(text);
    return result;
  });

  state.socketServer.register(BackIn.BROWSE_VIEW_INDEX, async (event, gameId, query) => {
    const position = await GameManager.findGameRow(
      gameId,
      query.filter,
      query.orderBy,
      query.orderReverse,
      undefined);

    return position - 1; // ("position" starts at 1, while "index" starts at 0)
  });

  state.socketServer.register(BackIn.SAVE_IMAGE, async (event, raw_folder, raw_id, content) => {
    const imageFolder = path.join(state.config.flashpointPath, state.preferences.imageFolderPath);
    const folder = sanitizeFilename(raw_folder);
    const id = sanitizeFilename(raw_id);
    const fullPath = path.join(imageFolder, folder, id.substring(0, 2), id.substring(2, 4), id + '.png');

    if (fullPath.startsWith(imageFolder)) { // (Ensure that it does not climb out of the image folder)
      try {
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, Buffer.from(content, 'base64'));
      } catch (e) {
        log.error('Launcher', e + '');
      }
    }

    state.socketServer.send(event.client, BackOut.IMAGE_CHANGE, folder, id);
  });

  state.socketServer.register(BackIn.DELETE_IMAGE, async (event, raw_folder, raw_id) => {
    const imageFolder = path.join(state.config.flashpointPath, state.preferences.imageFolderPath);
    const folder = sanitizeFilename(raw_folder);
    const id = sanitizeFilename(raw_id);
    const fullPath = path.join(imageFolder, folder, id.substring(0, 2), id.substring(2, 4), id + '.png');

    if (fullPath.startsWith(imageFolder)) { // (Ensure that it does not climb out of the image folder)
      try {
        if ((await fs.promises.stat(fullPath)).isFile()) {
          await fs.promises.unlink(fullPath);
          // @TODO Remove the two top folders if they are empty (so no empty folders are left hanging)
        }
      } catch (error: any) {
        if (error.code !== 'ENOENT') { console.error(error); }
      }
    }

    state.socketServer.send(event.client, BackOut.IMAGE_CHANGE, folder, id);
  });

  state.socketServer.register(BackIn.UPDATE_CONFIG, async (event, data) => {
    const newConfig = deepCopy(state.config);
    overwriteConfigData(newConfig, data);

    try { await ConfigFile.saveFile(path.join(state.configFolder, CONFIG_FILENAME), newConfig); }
    catch (error: any) { log.error('Launcher', error); }
  });

  state.socketServer.register(BackIn.UPDATE_PREFERENCES, async (event, data, refresh) => {
    const dif = difObjects(defaultPreferencesData, state.preferences, data);
    if (dif) {
      if ((typeof dif.currentLanguage  !== 'undefined' && dif.currentLanguage  !== state.preferences.currentLanguage) ||
          (typeof dif.fallbackLanguage !== 'undefined' && dif.fallbackLanguage !== state.preferences.fallbackLanguage)) {
        state.languageContainer = createContainer(
          state.languages,
          (typeof dif.currentLanguage !== 'undefined') ? dif.currentLanguage : state.preferences.currentLanguage,
          state.localeCode,
          (typeof dif.fallbackLanguage !== 'undefined') ? dif.fallbackLanguage : state.preferences.fallbackLanguage
        );
        state.socketServer.broadcast(BackOut.LANGUAGE_CHANGE, state.languageContainer);
      }

      overwritePreferenceData(state.preferences, dif);
      state.prefsQueue.push(() => {
        PreferencesFile.saveFile(path.join(state.config.flashpointPath, PREFERENCES_FILENAME), state.preferences, state);
      });
    }
    if (refresh) {
      state.socketServer.send(event.client, BackOut.UPDATE_PREFERENCES_RESPONSE, state.preferences);
    }
  });

  state.socketServer.register(BackIn.SERVICE_ACTION, async (event, action, id) => {
    const proc = state.services.get(id);
    if (proc) {
      switch (action) {
        case ProcessAction.START:
          proc.spawn();
          break;
        case ProcessAction.STOP:
          await proc.kill();
          break;
        case ProcessAction.RESTART:
          await proc.restart();
          break;
        default:
          console.warn('Unhandled Process Action');
      }
    }
  });

  state.socketServer.register(BackIn.GET_PLAYLIST, async (event, playlistId) => {
    return state.playlists.find(p => p.id === playlistId);
  });

  state.socketServer.register(BackIn.CLEANUP_TAG_ALIASES, async () => {
    await TagManager.cleanupTagAliases();
  });

  state.socketServer.register(BackIn.GET_TAG, async (event, data) => {
    const result = await TagManager.findTag(data);
    state.socketServer.send(event.client, BackOut.GET_TAG, result);
    return result;
  });

  state.socketServer.register(BackIn.FIX_TAG_PRIMARY_ALIASES, async (event) => {
    const fixed = await TagManager.fixPrimaryAliases();
    state.socketServer.send(event.client, BackOut.FIX_TAG_PRIMARY_ALIASES, fixed);
    return fixed;
  });

  state.socketServer.register(BackIn.GET_OR_CREATE_TAG, async (event, tagName, tagCategory) => {
    const name = tagName.trim();
    const category = tagCategory ? tagCategory.trim() : undefined;
    let tag = await TagManager.findTag(name);
    if (!tag) {
      // Tag doesn't exist, make a new one
      tag = await TagManager.createTag(name, category);
    }
    return tag;
  });

  state.socketServer.register(BackIn.GET_OR_CREATE_PLATFORM, async (event, platformName) => {
    const name = platformName.trim();
    let platform = await TagManager.findPlatform(name);
    if (!platform) {
      // Platform doesn't exist, make a new one
      platform = await TagManager.createPlatform(name);
    }
    return platform;
  });

  state.socketServer.register(BackIn.GET_PLAYLISTS, async () => {
    return filterPlaylists(state.playlists, state.preferences.browsePageShowExtreme);
  });

  state.socketServer.register(BackIn.SAVE_PLAYLIST, async (event, playlist) => {
    return updatePlaylist(state, playlist, playlist);
  });

  state.socketServer.register(BackIn.DELETE_PLAYLIST, async (event, playlistId) => {
    return deletePlaylist(state, playlistId);
  });

  state.socketServer.register(BackIn.GET_PLAYLIST_GAME, async (event, playlistId, gameId) => {
    return getPlaylistGame(state, playlistId, gameId);
  });

  state.socketServer.register(BackIn.ADD_PLAYLIST_GAME, async (event, playlistId, gameId) => {
    log.debug('Launcher', `Adding ${gameId} to ${playlistId}`);
    return addPlaylistGame(state, playlistId, gameId);
  });

  state.socketServer.register(BackIn.SAVE_PLAYLIST_GAME, async (event, playlistId, playlistGame) => {
    return savePlaylistGame(state, playlistId, playlistGame);
  });

  state.socketServer.register(BackIn.DELETE_PLAYLIST_GAME, async (event, playlistId, gameId) => {
    return deletePlaylistGame(state, playlistId, gameId);
  });

  state.socketServer.register(BackIn.EXPORT_PLAYLIST, async (event, playlistId, filePath) => {
    const playlist = state.playlists.find(p => p.id === playlistId);
    if (playlist) {
      return PlaylistFile.saveFile(filePath, playlist);
    }
  });

  state.socketServer.register(BackIn.SAVE_LEGACY_PLATFORM, async (event, platform) => {
    const translatedGames = [];
    const tagCache: Record<string, Tag> = {};
    for (const game of platform.collection.games) {
      const addApps = platform.collection.additionalApplications.filter(a => a.gameId === game.id);
      const translatedGame = await createGameFromLegacy(game, tagCache);
      translatedGame.addApps = createAddAppFromLegacy(addApps, translatedGame);
      translatedGames.push(translatedGame);
    }
    await GameManager.updateGames(translatedGames);
  });

  state.socketServer.register(BackIn.EXPORT_TAGS, async (event, data) => {
    const jsonTagsFile: TagsFile = { categories: [], tags: [], aliases: [] };
    let res: number;
    try {
      // Collect tag categories
      const allTagCategories = await TagManager.findTagCategories();
      jsonTagsFile.categories = allTagCategories;
      // Collect aliases
      const allTagAliases = await TagManager.dumpTagAliases();
      jsonTagsFile.aliases = allTagAliases;
      // Collect tags
      const allTags = await TagManager.findTags('');
      jsonTagsFile.tags = allTags.map(t => {
        const primaryAlias = t.aliases.find(a => a.id === t.primaryAliasId);
        const bareTag: BareTag = {
          id: t.id || 0,
          categoryId: t.categoryId || -1,
          description: t.description,
          primaryAlias: primaryAlias ? primaryAlias.name : 'ERROR'
        };
        return bareTag;
      });
      await fs.promises.writeFile(data, JSON.stringify(jsonTagsFile, null, ' '), { encoding: 'utf8' });
      res = allTags.length;
    } catch (error) {
      res = -1;
    }
    state.socketServer.send(event.client, BackOut.EXPORT_TAGS, res);
    return res;
  });

  state.socketServer.register(BackIn.EXPORT_DATABASE, async (event, data) => {
    let jsonFile: any = {
      games: {
        games: [],
        addApps: [],
        gameData: []
      },
      tags: {
        categories: [],
        tags: [],
        aliases: []
      },
      platforms: {
        platforms: [],
        aliases: []
      },
      tagRelations: [],
      platformRelations: []
    };

    // --- TAGS ---

    // Collect tag categories
    jsonFile.tags.categories = await TagManager.findTagCategories();
    // Collect aliases
    jsonFile.tags.aliases = await TagManager.dumpTagAliases();
    // Collect tags
    jsonFile.tags.tags = (await TagManager.findTags('')).map(t => {
      const primaryAlias = t.aliases.find(a => a.id === t.primaryAliasId);
      if (!primaryAlias || primaryAlias.name === '') {
        throw 'Failed for tag ' + t.id;
      }
      const bareTag: BareTag = {
        id: t.id || 0,
        categoryId: t.categoryId || -1,
        description: t.description || '',
        primaryAlias: primaryAlias ? primaryAlias.name : 'ERROR'
      };
      return bareTag;
    });

    // --- PLATFORMS ---

    // Collect aliases
    jsonFile.platforms.aliases = await TagManager.dumpPlatformAliases();
    // Collect tags
    jsonFile.platforms.platforms = (await TagManager.dumpPlatforms()).map(p => {
      const primaryAlias = p.aliases.find(a => a.id === p.primaryAliasId);
      const barePlatform: BarePlatform = {
        id: p.id || 0,
        description: p.description,
        primaryAlias: primaryAlias ? primaryAlias.name : 'ERROR'
      };
      return barePlatform;
    });

    // --- GAMES ----

    // Collect add apps
    jsonFile.games.addApps = await GameManager.dumpAddApps();
    // Collect game data
    jsonFile.games.gameData = await GameManager.dumpGameData();
    // Collect games
    let games = await GameManager.findAllGames();
    while (games.length > 0) {
      for (const game of games) {
        jsonFile.games.games.push({
          ...game,
          platforms: [],
          data: [],
          addApps: [],
          tags: []
        });
      }
      games = await GameManager.findAllGames(games[games.length - 1].id);
    }

    // --- RELATIONS ---
    jsonFile.tagRelations = await TagManager.dumpTagRelations();
    jsonFile.platformRelations = await TagManager.dumpPlatformRelations();

    // --- CONVERSION ---
    const snekify = (obj: Record<string, unknown>) => {
      return transform(obj, (result: Record<string, unknown>, value: unknown, key: string, target) => {
        const camelKey = Array.isArray(target) ? key : snakeCase(key);
        result[camelKey] = (value !== null && typeof value === 'object') ? snekify(value as Record<string, unknown>) : value;
      });
    };

    const res = 'Exported Database:' +
    `\nTag Categories: ${jsonFile.tags.categories.length.toString().padStart(5, ' ')} ` +
    `\nTag Alias: ${jsonFile.tags.aliases.length.toString().padStart(5, ' ')} ` +
    `\nTags: ${jsonFile.tags.tags.length.toString().padStart(11, ' ')} ` +
    `\nPlatform Aliases: ${jsonFile.platforms.aliases.length.toString().padStart(3, ' ')} ` +
    `\nPlatforms: ${jsonFile.platforms.platforms.length.toString().padStart(9, ' ')} ` +
    `\nGames: ${jsonFile.games.games.length.toString().padStart(14, ' ')} ` +
    `\nAdd Apps: ${jsonFile.games.addApps.length.toString().padStart(8, ' ')} ` +
    `\nGame Data: ${jsonFile.games.gameData.length.toString().padStart(10, ' ')} ` +
    `\nTag Relations: ${jsonFile.tagRelations.length.toString().padStart(2, ' ')} ` +
    `\nPlatform Relations: ${jsonFile.platformRelations.length.toString().padStart(2, ' ')} `;

    jsonFile = JSON.stringify(jsonFile, null, 0);
    jsonFile = JSON.parse(jsonFile);
    jsonFile = snekify(jsonFile);
    await fs.promises.writeFile(data, JSON.stringify(jsonFile,  null, ' '), { encoding: 'utf8' });

    return res;
  });

  state.socketServer.register(BackIn.IMPORT_TAGS, async (event, data) => {
    const json: TagsFile = JSON.parse(await fs.promises.readFile(data, 'utf8'));
    let res = 0;
    try {
      // Map JSON category ids to real categories
      const existingCats = await TagManager.findTagCategories();
      const categories: Record<number, TagCategory> = {};
      for (const rawCat of json.categories) {
        const foundCat = existingCats.find(c => c.name.toLowerCase() === rawCat.name.toLowerCase());
        if (foundCat) {
          categories[rawCat.id] = foundCat;
        } else {
          const newCat = await TagManager.createTagCategory(rawCat.name, rawCat.color);
          if (newCat) {
            categories[rawCat.id] = newCat;
          }
        }
      }
      // Create and fill tags
      for (const bareTag of json.tags) {
        const existingTag = await TagManager.findTag(bareTag.primaryAlias);
        if (existingTag) {
          // TODO: Detect alias collisions
        } else {
          await TagManager.createTag(bareTag.primaryAlias, categories[bareTag.categoryId].name, (json.aliases.filter(a => a.tagId === bareTag.id).map(a => a.name)).filter(a => a !== bareTag.primaryAlias));
          res += 1;
        }
      }
    } catch (error) {
      res = -1;
    }
    state.socketServer.send(event.client, BackOut.IMPORT_TAGS, res);
    await TagManager.sendTagCategories(state.socketServer);
    return res;
  });

  state.socketServer.register(BackIn.NUKE_TAGS, async (event, tagNames) => {
    // Get list of tags to nuke
    const tags: Tag[] = [];
    for (const tagName of tagNames) {
      const tag = await TagManager.findTag(tagName);
      if (tag) {
        tags.push(tag);
      }
    }

    // Find all matching games
    const games = new Set<Game>();
    for (const tag of tags) {
      const foundGames = await GameManager.findGamesWithTag(tag);
      for (const game of foundGames) {
        games.add(game);
      }
    }
    const gameIds = Array.from(games).map(g => g.id);

    // Remove games from any playlists
    for (const playlist of state.playlists) {
      let modified = false;
      for (let i = playlist.games.length - 1; i >= 0; i--) {
        const pg = playlist.games[i];
        if (gameIds.includes(pg.gameId)) {
          playlist.games.splice(i, 1);
          modified = true;
        }
      }
      if (modified) {
        await PlaylistFile.saveFile(playlist.filePath, playlist);
      }
    }

    // Remove games from database
    const gameChunks = chunkArray(Array.from(games), 20);
    for (const chunk of gameChunks) {
      await Promise.all(chunk.map(async game => {
        await GameManager.removeGameAndAddApps(game.id,
          path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath),
          path.join(state.config.flashpointPath, state.preferences.imageFolderPath),
          path.join(state.config.flashpointPath, state.preferences.htdocsFolderPath));
      }));
      state.queries = {}; // Reset search queries
    }

    // Remove tags from database
    for (const tag of tags) {
      if (tag.id) {
        await TagManager.deleteTag(tag.id, state, undefined, true);
      }
    }
  });

  state.socketServer.register(BackIn.IMPORT_CURATION, async (event, data) => {
    const { taskId } = data;
    let error: any | undefined;
    let processed = 0;
    const taskProgress = new TaskProgress(data.curations.length);
    if (taskId) {
      taskProgress.on('progress', (text, done) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: done,
        });
      });
      taskProgress.on('done', (text) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: 1,
          finished: true
        });
      });
    }
    for (const curation of data.curations) {
      try {
        processed += 1;
        taskProgress.setStage(processed, `Importing ${curation.game.title || curation.folder}...`);

        state.socketServer.broadcast(BackOut.CURATE_SELECT_LOCK, curation.folder, true);
        await importCuration({
          curation: curation,
          htdocsFolderPath: state.preferences.htdocsFolderPath,
          gameManager: state.gameManager,
          date: (data.date !== undefined) ? new Date(data.date) : undefined,
          saveCuration: data.saveCuration,
          fpPath: state.config.flashpointPath,
          dataPacksFolderPath: path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath),
          bluezipPath: pathToBluezip(state.isDev, state.exePath),
          imageFolderPath: state.preferences.imageFolderPath,
          openDialog: state.socketServer.showMessageBoxBack(state, event.client),
          openExternal: state.socketServer.openExternal(event.client),
          tagCategories: await TagManager.findTagCategories(),
          taskProgress,
          sevenZipPath: state.sevenZipPath,
          state,
        })
        .then(() => {
          // Delete curation afterwards
          deleteCuration(state, curation.folder);
          state.socketServer.broadcast(BackOut.CURATE_LIST_CHANGE, undefined, [curation.folder]);
        })
        .catch(() => {
          state.socketServer.broadcast(BackOut.CURATE_SELECT_LOCK, curation.folder, false);
          const alertString = formatString(state.languageContainer.dialog.errorImportingCuration, curation.folder) as string;
          state.socketServer.broadcast(BackOut.OPEN_ALERT, alertString);
        });
        state.queries = {};
      } catch (e) {
        if (util.types.isNativeError(e)) {
          error = copyError(e);
        } else {
          error = e;
        }
      }
    }

    if (data.taskId) {
      state.socketServer.broadcast(BackOut.UPDATE_TASK, data.taskId,
        {
          status: '',
          finished: true,
          error
        }
      );
    }

    return { error: error || undefined };
  });

  state.socketServer.register(BackIn.LAUNCH_CURATION, async (event, data) => {
    const { curation } = data;
    const skipLink = (curation.folder === state.lastLinkedCurationKey);
    state.lastLinkedCurationKey = data.symlinkCurationContent ? curation.folder : '';
    try {
      let serverOverride: string | undefined = undefined;
      if (state.serviceInfo) {
        // Make sure all 3 relevant server infos are present before considering MAD4FP opt
        const configServer = state.serviceInfo.server.find(s => s.name === state.preferences.curateServer);
        const mad4fpServer = state.serviceInfo.server.find(s => s.mad4fp);
        const activeServer = state.services.get('server');
        const activeServerInfo = state.serviceInfo.server.find(s => (activeServer && 'name' in activeServer.info && s.name === activeServer.info?.name));

        if (activeServerInfo) {
          if (data.mad4fp && mad4fpServer && !activeServerInfo.mad4fp) {
            // Swap to MAD4FP server
            serverOverride = mad4fpServer.name;
          } else if (configServer) {
            // Swap to default curate server (non-mad4fp)
            serverOverride = configServer.name;
          } else {
            serverOverride = activeServerInfo.name;
          }
        }
      }

      const flatPlatforms = makeFlatPlatforms(data.curation.game.platforms || []);
      await launchCuration(data.curation, data.symlinkCurationContent, skipLink, {
        fpPath: path.resolve(state.config.flashpointPath),
        htdocsPath: state.preferences.htdocsFolderPath,
        dataPacksFolderPath: state.preferences.dataPacksFolderPath,
        sevenZipPath: state.sevenZipPath,
        native: state.preferences.nativePlatforms.some(p => flatPlatforms.includes(p)),
        execMappings: state.execMappings,
        lang: state.languageContainer,
        isDev: state.isDev,
        exePath: state.exePath,
        appPathOverrides: state.preferences.appPathOverrides,
        providers: await getProviders(state),
        proxy: state.preferences.browserModeProxy,
        openDialog: state.socketServer.showMessageBoxBack(state, event.client),
        openExternal: state.socketServer.openExternal(event.client),
        runGame: runGameFactory(state),
        envPATH: state.pathVar,
        changeServer: changeServerFactory(state),
        state,
      },
      state.apiEmitters.games.onWillLaunchCurationGame.fireableFactory(state, event.client, 'Error during curate game launch api event'),
      state.apiEmitters.games.onDidLaunchCurationGame.fireableFactory(state, event.client, 'Error during curate post game launch api event'),
      serverOverride);
    } catch (e) {
      log.error('Launcher', e + '');
    }
  });

  state.socketServer.register(BackIn.LAUNCH_CURATION_ADDAPP, async (event, data) => {
    const skipLink = (data.folder === state.lastLinkedCurationKey);
    state.lastLinkedCurationKey = data.folder;
    try {
      const flatPlatforms = makeFlatPlatforms(data.platforms || []);
      await launchAddAppCuration(data.folder, data.addApp, data.platforms || [], data.symlinkCurationContent, skipLink, {
        fpPath: path.resolve(state.config.flashpointPath),
        htdocsPath: state.preferences.htdocsFolderPath,
        dataPacksFolderPath: state.preferences.dataPacksFolderPath,
        sevenZipPath: state.sevenZipPath,
        native: state.preferences.nativePlatforms.some(p => flatPlatforms.includes(p)) || false,
        execMappings: state.execMappings,
        lang: state.languageContainer,
        isDev: state.isDev,
        exePath: state.exePath,
        appPathOverrides: state.preferences.appPathOverrides,
        providers: await getProviders(state),
        proxy: state.preferences.browserModeProxy,
        openDialog: state.socketServer.showMessageBoxBack(state, event.client),
        openExternal: state.socketServer.openExternal(event.client),
        runGame: runGameFactory(state),
        changeServer: changeServerFactory(state),
        envPATH: state.pathVar,
        state,
      },
      state.apiEmitters.games.onWillLaunchCurationAddApp.fireableFactory(state, event.client, 'Error during curate add app launch api event'),
      state.apiEmitters.games.onDidLaunchCurationAddApp.fireableFactory(state, event.client, 'Error during curate post add app launch api event'));
    } catch (e) {
      log.error('Launcher', e + '');
    }
  });

  state.socketServer.register(BackIn.OPEN_LOGS_WINDOW, async () => {
    if (!state.services.has('logger_window')) {
      const env: NodeJS.ProcessEnv = {...process.env, 'PATH': state.pathVar ?? process.env.PATH};
      if ('ELECTRON_RUN_AS_NODE' in env) {
        delete env['ELECTRON_RUN_AS_NODE']; // If this flag is present, it will disable electron features from the process
      }
      const loggerArgs = [path.join(__dirname, '../main/index.js'), 'logger=true'];
      const dirname = path.dirname(process.execPath);
      runService(
        state,
        'logger_window',
        'Logger Window',
        '',
        {
          detached: false,
          noshell: true,
          cwd: getCwd(state.isDev, state.exePath),
          env: env
        },
        {
          path: dirname,
          filename: process.execPath,
          arguments: escapeArgsForShell(loggerArgs),
          kill: true
        }
      );
    } else {
      const loggerService = state.services.get('logger_window');
      if (loggerService && loggerService.getState() !== ProcessState.RUNNING) {
        loggerService.restart();
      }
    }
  });

  state.socketServer.register(BackIn.UPLOAD_LOG, async (event) => {
    // Upload to log server
    const entries = state.log.filter(e => e !== undefined);
    const postUrl = url.resolve(state.config.logsBaseUrl, 'logdata');
    // Server responds with log id e.g ABC123
    const res = await axios.post(postUrl, { entries: entries });
    const id = res.data;
    // Form into GET URL
    let getUrl: string | undefined;
    if (id) {
      getUrl = url.resolve(state.config.logsBaseUrl, `log?id=${id}`);
    }
    // Send back to client
    state.socketServer.send(event.client, BackOut.UPLOAD_LOG, getUrl);
    return getUrl;
  });

  state.socketServer.register(BackIn.FETCH_DIAGNOSTICS, async () => {
    type Diagnostics = {
      services: Array<{
        id: string;
        name: string;
        state: ProcessState;
      }>;
      generics: string[];
    }
    // services
    const diagnostics: Diagnostics = {
      services: Array.from(state.services.values()).map(s => {
        return {
          id: s.id,
          name: s.name,
          state: s.getState()
        };
      }),
      generics: []
    };

    // generics

    if (!fs.existsSync(path.join(state.config.flashpointPath, 'Legacy', 'router.php'))) {
      diagnostics.generics.push('router.php is missing. Possible cause: Anti-Virus software has deleted it.');
    }
    if (state.log.findIndex(e => e.content.includes('Server exited with code 3221225781')) !== -1) {
      diagnostics.generics.push('Server exited with code 3221225781. Possible cause: .NET Framework or Visual C++ 2015 x86 Redists are not installed.');
    }

    // print

    let message = '';
    const maxLen = 'Operating System: '.length;
    message = message + 'Operating System: ' + os.version() + '\n';
    message = message + padEnd('Architecture:', maxLen) + os.arch() + '\n';
    try {
      const output = execSync('powershell.exe -Command "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct | Format-Wide -Property displayName"').toString().trim();
      if (output.toLowerCase().includes('avast') || output.toLowerCase().includes('avg')) {
        diagnostics.generics.push('AVG or Avast Anti-Virus is installed. This may cause problems with Flashpoint.');
      }
      message = message + padEnd('Anti-Virus:', maxLen) + output + '\n';
    } catch (err) {
      message = message + 'Anti-Virus:\tUnknown\n';
    }
    message = message + '\n';
    for (const service of diagnostics.services) {
      message = message + `${ProcessState[service.state]}:\t${service.name}\n`;
    }
    if (diagnostics.generics.length > 0) {
      message = message + '\n';
      message = message + 'Warnings:\n';
    }
    for (const generic of diagnostics.generics) {
      message = message + `\t${generic}\n`;
    }
    message = message + '\n';
    for (const service of diagnostics.services) {
      const serviceLogs = state.log.filter(e => e.source === service.name);
      if (serviceLogs.length > 0) {
        message = message + `${service.name} recent logs:\n`;
        for (const log of serviceLogs.slice(0, serviceLogs.length > 10 ? 10 : undefined)) {
          message = message + `\t${log.content}\n`;
        }
      }
    }

    return '```' + message + '```';
  });

  state.socketServer.register(BackIn.OPEN_FLASHPOINT_MANAGER, async () => {
    const cwd = path.join(state.config.flashpointPath, 'Manager');
    const fpmPath = 'FlashpointManager.exe';
    const updatesReady = state.componentStatuses.filter(c => c.state === ComponentState.NEEDS_UPDATE).length > 0;
    exitApp(state, async () => {
      const args = updatesReady ? ['/update', '/launcher'] : ['/launcher'];
      const child = child_process.spawn(fpmPath, args, { detached: true, cwd, stdio: ['ignore', 'ignore', 'ignore'] });
      child.unref();
    });
  });

  state.socketServer.register(BackIn.QUIT, async () => {
    return exitApp(state);
  });

  state.socketServer.register(BackIn.EXPORT_META_EDIT, async (event, id, properties) => {
    const game = await GameManager.findGame(id);
    if (game) {
      const meta: MetaEditMeta = {
        id: game.id,
      };

      const keys = Object.keys(properties) as (keyof typeof properties)[];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (properties[key]) {
          switch (key) {
            case 'tags': {
              meta.tags = game.tags.map(tag => tag.primaryAlias.name);
              break;
            }
            case 'platforms': {
              meta.platforms = game.platforms.map(tag => tag.primaryAlias.name);
              break;
            }
            default:
              (meta as any)[key] = game[key]; // (I wish typescript could understand this...)
          }
        }
      }

      const output: MetaEditFile = {
        metas: [meta],
        launcherVersion: state.version,
      };

      const folderPath = path.join(state.config.flashpointPath, state.preferences.metaEditsFolderPath);
      const filePath = path.join(folderPath, game.id + '.json');
      try {
        let save = true;

        if (await pathExists(filePath)) {
          const strings = state.languageContainer;
          const dialogId = await state.socketServer.showMessageBoxBack(state, event.client)({
            message: `${strings.dialog.overwriteFileMessage}\n${strings.dialog.overwriteFileDetail}\n${filePath}`,
            buttons: [strings.misc.yes, strings.misc.no],
            cancelId: 1,
          });
          const result = (await awaitDialog(state, dialogId)).buttonIdx;

          if (result === 1) { save = false; }
        }

        if (save) {
          await fs_extra.ensureDir(folderPath);
          await fs.promises.writeFile(filePath, JSON.stringify(output, null, '\t'));
        }
      } catch (error: any) {
        log.error('Launcher', `Failed to export meta edit.\nError: ${error.message || error}`);
      }
    }
  });

  state.socketServer.register(BackIn.IMPORT_META_EDITS, async (event) => {
    const result = await importAllMetaEdits(
      path.join(state.config.flashpointPath, state.preferences.metaEditsFolderPath),
      state.socketServer.showMessageBoxBack(state, event.client),
      state,
    );

    return result;
  });

  state.socketServer.register(BackIn.CURATE_LOAD_ARCHIVES, async (event, filePaths, taskId) => {
    let processed = 0;
    const taskProgress = new TaskProgress(filePaths.length);
    if (taskId) {
      taskProgress.on('progress', (text, done) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: done,
        });
      });
      taskProgress.on('done', (text) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: 1,
          finished: true
        });
      });
    }
    for (const filePath of filePaths) {
      processed = processed + 1;
      taskProgress.setStage(processed, `Loading ${filePath}`);
      await loadCurationArchive(filePath, throttle((progress: Progress) => {
        taskProgress.setStageProgress((progress.percent / 100), `Extracting Files - ${progress.fileCount}`);
      }, 200))
      .catch((error) => {
        log.error('Curate', `Failed to load curation archive! ${error.toString()}`);
        state.socketServer.broadcast(BackOut.OPEN_ALERT, formatString(state.languageContainer['dialog'].failedToLoadCuration, error.toString())  as string);
      });
      taskProgress.setStageProgress(1, 'Extracted');
    }
    taskProgress.done('Loaded Curation Archives');
  });

  state.socketServer.register(BackIn.CURATE_GEN_WARNINGS, async (event, curation) => {
    return genCurationWarnings(curation, state.config.flashpointPath, state.suggestions, state.languageContainer.curate, state.apiEmitters.curations.onWillGenCurationWarnings);
  });

  state.socketServer.register(BackIn.CURATE_GET_LIST, async () => {
    return state.loadedCurations;
  });

  state.socketServer.register(BackIn.CURATE_DUPLICATE, async (event, folders) => {
    for (const folder of folders) {
      await duplicateCuration(folder, state);
    }
  });

  state.socketServer.register(BackIn.CURATE_SYNC_CURATIONS, async (event, curations) => {
    for (const curation of curations) {
      const idx = state.loadedCurations.findIndex(c => c.folder === curation.folder);
      if (idx > -1) {
        state.loadedCurations[idx] = {
          ...curation,
          contents: curation.contents ? curation.contents : state.loadedCurations[idx].contents
        };
        state.apiEmitters.curations.onDidCurationChange.fire(state.loadedCurations[idx]);
        // Save curation
        saveCuration(path.join(state.config.flashpointPath, CURATIONS_FOLDER_WORKING, curation.folder), curation)
        .then(() => state.apiEmitters.curations.onDidCurationChange.fire(state.loadedCurations[idx]));
      }
    }
  });

  state.socketServer.register(BackIn.CURATE_EDIT_REMOVE_IMAGE, async (event, folder, type) => {
    const curationIdx = state.loadedCurations.findIndex(c => c.folder === folder);
    if (curationIdx > -1) {
      const curation = state.loadedCurations[curationIdx];
      switch (type) {
        case CurationImageEnum.THUMBNAIL: {
          const imagePath = curation.thumbnail.exists ? curation.thumbnail.filePath : undefined;
          if (imagePath) {
            await fs.promises.unlink(imagePath);
            curation.thumbnail.exists = false;
            state.socketServer.broadcast(BackOut.CURATE_LIST_CHANGE, [curation]);
            // TODO: Send update
          }
          break;
        }
        case CurationImageEnum.SCREENSHOT: {
          const imagePath = curation.screenshot.exists ? curation.screenshot.filePath : undefined;
          if (imagePath) {
            await fs.promises.unlink(imagePath);
            curation.screenshot.exists = false;
            state.socketServer.broadcast(BackOut.CURATE_LIST_CHANGE, [curation]);
            // TODO: Send update
          }
          break;
        }
      }
    }
  });

  state.socketServer.register(BackIn.CURATE_DELETE, async (event, folders, taskId) => {
    try {
      for (let idx = 0; idx < folders.length; idx++) {
        if (taskId) {
          state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
            status: `Deleting ${folders[idx]}...`,
            progress: idx / folders.length
          });
        }
        await deleteCuration(state, folders[idx]);
      }
      if (taskId) {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: '',
          finished: true
        });
      }
    } catch (e: any) {
      log.error('Curate', `Failed to delete curation: ${e}`);
      if (taskId) {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          error: e.toString(),
          finished: true
        });
      }
    }
  });

  state.socketServer.register(BackIn.CURATE_EXPORT_DATA_PACK, async (event, curations, taskId) => {
    const bluezipPath = pathToBluezip(state.isDev, state.exePath);
    const dataPackFolder = path.join(state.config.flashpointPath, CURATIONS_FOLDER_EXPORTED, 'Data Packs');
    await fs.ensureDir(dataPackFolder);
    let processed = 0;

    try {
      for (const curation of curations) {
        if (taskId) {
          state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
            status: `Exporting Data Pack for ${curation.game.title || curation.folder}`,
            progress: processed / curations.length,
          });
        }
        processed += 1;
        const fpPath = state.config.flashpointPath;
        const curationPath = path.resolve(getCurationFolder(curation, fpPath));
        // Make a temp copy
        const tempFolder = uuid();
        const copyPath = path.resolve(fpPath, CURATIONS_FOLDER_TEMP, tempFolder);
        await copyFolder(curationPath, copyPath);
        const bluezipProc = child_process.spawn('bluezip', [copyPath, '-no', copyPath], {cwd: path.dirname(bluezipPath)});
        await new Promise<void>((resolve, reject) => {
          bluezipProc.stdout.on('data', (data: any) => {
            log.debug('Curate', `Bluezip output: ${data}`);
          });
          bluezipProc.stderr.on('data', (data: any) => {
            log.debug('Curate', `Bluezip error: ${data}`);
          });
          bluezipProc.on('close', (code: any) => {

            if (code) {
              log.error('Curate', `Bluezip exited with code: ${code}`);
              reject();
            } else {
              log.debug('Curate', 'Bluezip exited successfully.');
              resolve();
            }
          });
        });
        // Import bluezip
        const filePath = path.join(copyPath, `${tempFolder}.zip`);
        await fs.move(filePath, path.join(dataPackFolder, `${curation.uuid} - ${sanitizeFilename(curation.game.title || curation.folder)}.zip`), { overwrite: true });
      }
      if (taskId) {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: '',
          finished: true
        });
      }
    } catch (e: any) {
      if (taskId) {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          finished: true,
          error: e ? e.toString() : 'Undefined error',
        });
      }
    }
  });

  state.socketServer.register(BackIn.CURATE_EXPORT, async (event, curations, taskId) => {
    let processed = 0;
    const taskProgress = new TaskProgress(curations.length);
    if (taskId) {
      taskProgress.on('progress', (text, done) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: done,
        });
      });
      taskProgress.on('done', (text) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: 1,
          finished: true
        });
      });
    }
    for (const curation of curations) {
      processed += 1;
      taskProgress.setStage(processed, `Exporting ${curation.game.title || curation.folder}`);
      // Find most appropriate filepath based on what already exists
      const name = (curation.game.title ? sanitizeFilename(curation.game.title) : curation.folder);
      const filePathCheck = path.join(state.config.flashpointPath, CURATIONS_FOLDER_EXPORTED, `${name}.7z`);
      const filePath = await fs.promises.access(filePathCheck, fs.constants.F_OK)
      .then(() => {
        // Exists, use date instead
        return path.join(state.config.flashpointPath, CURATIONS_FOLDER_EXPORTED, `${name}_${dateToFilenameString(new Date())}.7z`);
      })
      .catch(() => { return filePathCheck; /** Doesn't exist, carry on */ });
      await fs.ensureDir(path.dirname(filePath));
      const curPath = path.join(state.config.flashpointPath, CURATIONS_FOLDER_WORKING, curation.folder);
      await saveCuration(curPath, curation);
      await new Promise<void>((resolve) => {
        return add(filePath, curPath, { recursive: true, $bin: pathTo7zBack(state.isDev, state.exePath) })
        .on('end', () => { resolve(); })
        .on('error', (error) => {
          log.error('Curate', error.message);
          resolve();
        });
      })
      .finally(() => {
        state.socketServer.broadcast(BackOut.CURATE_SELECT_LOCK, curation.folder, false);
      });
      taskProgress.setStageProgress(1, 'Packed');
    }
    taskProgress.done('Exported Curations');
  });

  state.socketServer.register(BackIn.CURATE_REFRESH_CONTENT, async (event, folder) => {
    return refreshCurationContent(state, folder);
  });

  state.socketServer.register(BackIn.CURATE_SCAN_NEW_CURATIONS, async () => {
    const curationsPath = path.join(state.config.flashpointPath, CURATIONS_FOLDER_WORKING);
    await fs.ensureDir(curationsPath);
    const curations = await fs.promises.readdir(curationsPath, { withFileTypes: true });
    for (const curation of curations) {
      console.log(curation.name);
      if (curation.isDirectory()) {
        const exists = state.loadedCurations.find(c => c.folder === curation.name);
        if (!exists) {
          await loadCurationFolder(curationsPath, curation.name, state);
          const curationIdx = state.loadedCurations.findIndex(c => c.folder === curation.name);
          state.socketServer.broadcast(BackOut.CURATE_LIST_CHANGE, [state.loadedCurations[curationIdx]]);
        }
      }
    }
  });

  state.socketServer.register(BackIn.CURATE_FROM_GAME, async (event, gameId) => {
    return makeCurationFromGame(state, gameId);
  });

  state.socketServer.register(BackIn.CURATE_CREATE_CURATION, async (event, folder, meta) => {
    const existingCuration = state.loadedCurations.find(c => c.folder === folder);
    if (!existingCuration) {
      const curPath = path.join(state.config.flashpointPath, CURATIONS_FOLDER_WORKING, folder);
      await fs.promises.mkdir(curPath, { recursive: true });
      const contentFolder = path.join(curPath, 'content');
      await fs.promises.mkdir(contentFolder, { recursive: true });

      const defaultPlats = await TagManager.findPlatform('Flash');

      const data: LoadedCuration = {
        folder,
        uuid: uuid(),
        group: '',
        game: meta || {
          language: 'en',
          primaryPlatform: defaultPlats ? defaultPlats.primaryAlias.name : undefined,
          platforms: defaultPlats ? [defaultPlats] : [],
          playMode: 'Single Player',
          status:   'Playable',
          library:  'Arcade'.toLowerCase() // must be lower case
        },
        addApps: [],
        thumbnail: await loadCurationIndexImage(path.join(curPath, 'logo.png')),
        screenshot: await loadCurationIndexImage(path.join(curPath, 'ss.png'))
      };
      if (data.game.primaryPlatform && data.game.primaryPlatform in state.platformAppPaths) {
        data.game.applicationPath = state.platformAppPaths[data.game.primaryPlatform][0].appPath;
      }
      const curation: CurationState = {
        ...data,
        alreadyImported: false,
        warnings: await genCurationWarnings(data, state.config.flashpointPath, state.suggestions, state.languageContainer.curate, state.apiEmitters.curations.onWillGenCurationWarnings),
        contents: await genContentTree(getContentFolderByKey(folder, state.config.flashpointPath))
      };
      await saveCuration(curPath, curation);
      state.loadedCurations.push(curation);
      state.socketServer.broadcast(BackOut.CURATE_LIST_CHANGE, [curation]);
    }
  });

  state.socketServer.register(BackIn.FPFSS_OPEN_CURATION, async (event, url, accessToken, taskId) => {
    // Setup task info
    const taskProgress = new TaskProgress(2);
    if (taskId) {
      taskProgress.on('progress', (text, done) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: done,
        });
      });
      taskProgress.on('done', (text) => {
        state.socketServer.broadcast(BackOut.UPDATE_TASK, taskId, {
          status: text,
          progress: 1,
          finished: true
        });
      });
    }

    // Download to temp file
    let tempFile = '';
    try {
      taskProgress.setStage(1, `Downloading ${url}`);
      tempFile = await getTempFilename('.7z');
      await downloadFile(url, tempFile, undefined, undefined, undefined, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      taskProgress.setStageProgress(1, 'Downloaded');
    } catch (err) {
      throw 'Error downloading curation file';
    }


    taskProgress.setStage(2, `Loading ${tempFile}`);
    await loadCurationArchive(tempFile, throttle((progress: Progress) => {
      taskProgress.setStageProgress((progress.percent / 100), `Extracting Files - ${progress.fileCount}`);
    }, 200))
    .catch((error) => {
      log.error('Curate', `Failed to load curation archive! ${error.toString()}`);
      state.socketServer.broadcast(BackOut.OPEN_ALERT, formatString(state.languageContainer['dialog'].failedToLoadCuration, error.toString())  as string);
    });
    taskProgress.setStageProgress(2, 'Extracted');
    taskProgress.done('Imported FPFSS Curation');
  });

  state.socketServer.register(BackIn.CLEAR_PLAYTIME_TRACKING, async (event) => {
    const openDialog = state.socketServer.showMessageBoxBack(state, event.client);
    const dialogId = await openDialog({
      message: 'Clearing Playtime Data...',
      largeMessage: true,
      buttons: []
    });
    await GameManager.clearPlaytimeTracking()
    .finally(() => {
      state.socketServer.broadcast(BackOut.CANCEL_DIALOG, dialogId);
    });
  });

  state.socketServer.register(BackIn.RUN_COMMAND, async (event, command, args = []) => {
    // Find command
    const c = state.registry.commands.get(command);
    let res = undefined;
    let success = false;
    if (c) {
      // Run Command
      try {
        res = await Promise.resolve(c.callback(...args));
        success = true;
      } catch (error) {
        log.error('Launcher', `Error running Command (${command})\n${error}`);
      }
    } else {
      log.error('Launcher', `Command requested but "${command}" not registered!`);
    }
    // Return response
    const result = {
      success: success,
      res: res,
    };
    state.socketServer.send(event.client, BackOut.RUN_COMMAND, result);
    return result;
  });

  state.socketServer.register(BackIn.SET_EXT_CONFIG_VALUE, async (event, key, value) => {
    state.extConfig[key] = value;
    await ExtConfigFile.saveFile(path.join(state.config.flashpointPath, EXT_CONFIG_FILENAME), state.extConfig);
    state.socketServer.send(event.client, BackOut.UPDATE_EXT_CONFIG_DATA, state.extConfig);
  });

  state.socketServer.register(BackIn.NEW_DIALOG_RESPONSE, (event, dialogId, code) => {
    state.newDialogEvents.emit(code, dialogId);
  });

  state.socketServer.register(BackIn.DIALOG_RESPONSE, (event, dialog, buttonIdx) => {
    state.resolveDialogEvents.emit(dialog.id, dialog, buttonIdx);
  });

  state.socketServer.register(BackIn.DELETE_ALL_IMAGES, async (event) => {
    // Display dialog to prevent user input
    const openDialog = state.socketServer.showMessageBoxBack(state, event.client);
    const dialogId = await openDialog({
      message: 'Deleting Images, Please Wait...',
      buttons: []
    });
    const imagesFolder = path.join(state.config.flashpointPath, state.preferences.imageFolderPath);
    // Delete images
    try {
      await fs.remove(imagesFolder);
    } finally {
      setTimeout(() => {
        // Close dialog, finished task
        state.socketServer.broadcast(BackOut.CANCEL_DIALOG, dialogId);
      }, 1000);
      await fs.ensureDir(imagesFolder);
    }
  });

  state.socketServer.register(BackIn.IMPORT_METADATA, async (event, data) => {
    console.log('importing platforms');
    // Import platforms
    await importPlatforms(data.platforms);
    console.log('importing tag cats');
    // Import tag cats
    await importTagCategories(data.categories);
    console.log('importing tags');
    // Import tags
    await importTags(data.tags);
    console.log('importing games');
    // Import games
    await importGames(data.games);
    // Check for extras
    if (data.gameDataSources) {
      // Add any extra sources
      for (const source of data.gameDataSources) {
        const existingSourceIdx = state.preferences.gameDataSources.findIndex(s => s.name === source.name);
        if (existingSourceIdx > -1) {
          state.preferences.gameDataSources[existingSourceIdx] = source;
        } else {
          state.preferences.gameDataSources.push(source);
        }
      }
    }
    if (data.tagFilters) {
      // Add any extra filters
      for (const tfg of data.tagFilters) {
        const existingTfgIdx = state.preferences.tagFilters.findIndex(tfg => tfg.name === tfg.name);
        if (existingTfgIdx > -1) {
          state.preferences.tagFilters[existingTfgIdx] = tfg;
        } else {
          state.preferences.tagFilters.push(tfg);
        }
      }
    }
    // Save prefs
    state.prefsQueue.push(() => {
      PreferencesFile.saveFile(path.join(state.config.flashpointPath, PREFERENCES_FILENAME), state.preferences, state);
    });
  });

  state.socketServer.register(BackIn.SYNC_METADATA_SERVER, async (event, serverInfo) => {
    // OUTDATED CODE
    switch (serverInfo.type) {
      case 'raw': {
        // Download file
        const data: MetadataRaw = unsafeParseJsonBuffer(await downloadJsonDataToBuffer(serverInfo.host));
        // Import platforms
        await importPlatforms(data.platforms);
        // Import tags
        await importTags(data.tags);
        // Import games
        await importGames(data.games);
        break;
      }
      case 'python': {
        break;
      }
      default:
        throw 'Unsupported type';
    }
  });

  state.socketServer.register(BackIn.OPTIMIZE_DATABASE, async (event) => {
    const dialogId = await createNewDialog(state, {
      largeMessage: true,
      message: 'Optimizing Database...',
      buttons: []
    });
    // Make the user feel like we're doing something special
    await promiseSleep(1000);
    // Actually do the work now
    await optimizeDatabase(state, dialogId)
    .finally(() => {
      state.socketServer.broadcast(BackOut.CANCEL_DIALOG, dialogId);
    });
  });
}

/**
 * Recursively iterate over all properties of the template object and compare the values of the same
 * properties in object A and B. All properties that are not equal will be added to the returned object.
 * Missing properties, or those with the value undefined, in B will be ignored.
 * If all property values are equal undefined is returned.
 *
 * __Note:__ Arrays work differently in order to preserve the types and indices.
 * If the length of the arrays are not equal, or if not all items in the array are strictly equal (to the items of the other array),
 * then the whole array will be added to the return object.
 *
 * @param template Template object. Iteration will be done over this object.
 * @param a Compared to B.
 * @param b Compared to A. Values in the returned object is copied from this.
 */
function difObjects<T>(template: T, a: T, b: DeepPartial<T>): DeepPartial<T> | undefined {
  let dif: DeepPartial<T> | undefined;

  for (const key in template) {
    const tVal = template[key];
    const aVal = a[key];
    const bVal = b[key];

    if (aVal !== bVal && bVal !== undefined) {
      // Array
      if (Array.isArray(tVal) && Array.isArray(aVal) && Array.isArray(bVal)) {
        let notEqual = false;

        if (aVal.length === bVal.length) {
          for (let i = 0; i < aVal.length; i++) {
            if (aVal[i] !== bVal[i]) {
              notEqual = true;
              break;
            }
          }
        } else {
          notEqual = true;
        }

        if (notEqual) {
          if (!dif) { dif = {}; }
          dif[key] = [ ...bVal ] as any;
        }
      }
      // Object
      else if (typeof tVal === 'object' && typeof aVal === 'object' && typeof bVal === 'object') {
        const subDif = difObjects(tVal, aVal, bVal as any);
        if (subDif) {
          if (!dif) { dif = {}; }
          dif[key] = subDif as any;
        }
      }
      // Other
      else {
        if (!dif) { dif = {}; }
        // Works, but type checker complains
        dif[key] = bVal as any;
      }
    }
  }

  return dif;
}

function adjustGameFilter(filterOpts: FilterGameOpts): FilterGameOpts {
  if (filterOpts && filterOpts.playlist && filterOpts.searchQuery) {
    // Remove library filter if viewing playlist
    let index = filterOpts.searchQuery.whitelist.findIndex(f => f.field === 'library');
    while (index > -1) {
      filterOpts.searchQuery.whitelist.splice(index);
      index = filterOpts.searchQuery.whitelist.findIndex(f => f.field === 'library');
    }
    index = filterOpts.searchQuery.blacklist.findIndex(f => f.field === 'library');
    while (index > -1) {
      filterOpts.searchQuery.blacklist.splice(index);
      index = filterOpts.searchQuery.blacklist.findIndex(f => f.field === 'library');
    }
  }
  return filterOpts;
}

/**
 * Creates a function that will run any game launch info given to it and register it as a service
 *
 * @param state Current back state
 */
function runGameFactory(state: BackState) {
  return (gameLaunchInfo: GameLaunchInfo): ManagedChildProcess => {
    // Run game as a service and register it
    const dirname = path.dirname(gameLaunchInfo.launchInfo.gamePath);
    // Keep file path relative to cwd
    const proc = runService(
      state,
      `game.${gameLaunchInfo.game.id}`,
      gameLaunchInfo.game.title,
      '',
      {
        detached: false,
        cwd: gameLaunchInfo.launchInfo.cwd,
        noshell: !!gameLaunchInfo.launchInfo.noshell,
        env: gameLaunchInfo.launchInfo.env
      },
      {
        path: dirname,
        filename: createCommand(gameLaunchInfo.launchInfo.gamePath, gameLaunchInfo.launchInfo.useWine, !!gameLaunchInfo.launchInfo.noshell),
        // Don't escape args if we're not using a shell.
        arguments: gameLaunchInfo.launchInfo.noshell
          ? typeof gameLaunchInfo.launchInfo.gameArgs == 'string'
            ? [gameLaunchInfo.launchInfo.gameArgs]
            : gameLaunchInfo.launchInfo.gameArgs
          : escapeArgsForShell(gameLaunchInfo.launchInfo.gameArgs),
        kill: true
      }
    );
    if (proc.getState() === ProcessState.RUNNING) {
      // Update game last played
      if (state.preferences.enablePlaytimeTracking) {
        if (!state.preferences.enablePlaytimeTrackingExtreme) {
          const extremeTags = state.preferences.tagFilters.filter(t => t.extreme).reduce<string[]>((prev, cur) => prev.concat(cur.tags), []);
          const isExtreme = gameLaunchInfo.game.tagsStr.split(';').findIndex(t => extremeTags.includes(t.trim())) !== -1;
          if (!isExtreme) {
            GameManager.logGameStart(gameLaunchInfo.game.id);
          }
        } else {
          GameManager.logGameStart(gameLaunchInfo.game.id);
        }
      }
    } else {
      proc.on('change', async () => {
        if (proc.getState() === ProcessState.RUNNING) {
          // Update game last played
          if (state.preferences.enablePlaytimeTracking) {
            if (!state.preferences.enablePlaytimeTrackingExtreme) {
              const extremeTags = state.preferences.tagFilters.filter(t => t.extreme).reduce<string[]>((prev, cur) => prev.concat(cur.tags), []);
              const isExtreme = gameLaunchInfo.game.tagsStr.split(';').findIndex(t => extremeTags.includes(t.trim())) !== -1;
              if (!isExtreme) {
                GameManager.logGameStart(gameLaunchInfo.game.id);
              }
            } else {
              GameManager.logGameStart(gameLaunchInfo.game.id);
            }
          }
        }
      });
    }
    // Remove game service when it exits
    proc.on('change', () => {
      if (proc.getState() === ProcessState.STOPPED) {
        // Update game playtime counter
        if (state.preferences.enablePlaytimeTracking) {
          if (!state.preferences.enablePlaytimeTrackingExtreme) {
            const extremeTags = state.preferences.tagFilters.filter(t => t.extreme).reduce<string[]>((prev, cur) => prev.concat(cur.tags), []);
            const isExtreme = gameLaunchInfo.game.tagsStr.split(';').findIndex(t => extremeTags.includes(t.trim())) !== -1;
            if (!isExtreme) {
              GameManager.addGamePlaytime(gameLaunchInfo.game.id, Date.now() - proc.getStartTime());
            }
          } else {
            GameManager.addGamePlaytime(gameLaunchInfo.game.id, Date.now() - proc.getStartTime());
          }
        }
        removeService(state, proc.id);
      }
    });

    return proc;
  };
}

function createCommand(filename: string, useWine: boolean, noshell: boolean): string {
  // This whole escaping thing is horribly broken. We probably want to switch
  // to an array representing the argv instead and not have a shell
  // in between.
  switch (process.platform) {
    case 'win32':
      return noshell ? filename : `"${filename}"`; // Quotes cause issues without a shell.
    case 'darwin':
    case 'linux':
      if (useWine) {
        return `wine start /wait /unix "${filename}"`;
      }
      return noshell ? filename : `"${filename}"`;
    default:
      throw Error('Unsupported platform');
  }
}

/**
 * Run a command registered by an Extension
 *
 * @param state Back state
 * @param command Command to run
 * @param args Arguments for the command
 */
async function runCommand(state: BackState, command: string, args: any[] = []): Promise<any> {
  const callback = state.registry.commands.get(command);
  let res = undefined;
  if (callback) {
    // Run Command
    try {
      res = await Promise.resolve(callback.callback(...args));
    } catch (error) {
      throw new Error(`Error running Command (${command})\n${error}`);
    }
  } else {
    throw new Error(`Command requested but "${command}" not registered!`);
  }
  return res;
}

/**
 * Returns a set of AppProviders from all extension registered Applications, complete with callbacks to run them.
 *
 * @param state Current back state
 */
async function getProviders(state: BackState): Promise<AppProvider[]> {
  return state.extensionsService.getContributions('applications')
  .then(contributions => {
    return contributions.map(c => {
      const apps = c.value;
      return apps.map(app => {
        return {
          ...app,
          callback: async (game: Game, launchCommand: string) => {
            if (app.command) {
              return runCommand(state, app.command, [game]);
            } else if (app.path) {
              const parsedArgs = await Promise.all(app.arguments.map(a => parseAppVar(c.extId, a, launchCommand, state)));
              const parsedPath = await parseAppVar(c.extId, app.path, launchCommand, state);
              return [parsedPath, ...parsedArgs];
            } else if (app.url) {
              const formattedUrl = await parseAppVar(c.extId, app.url, launchCommand, state);
              const opts: BrowserApplicationOpts = {
                url: formattedUrl
              };
              return opts;
            } else {
              throw new Error('Neither path or command are defined for application, cannot run.');
            }
          }
        };
      });
    })
    .reduce((prev, cur) => cur.concat(prev), []);
  }
  );
}

function changeServerFactory(state: BackState): (server?: string) => Promise<void> {
  return async (server?: string) => {
    if (state.serviceInfo) {
      if (!server) {
        // No server name given, assume the default server
        server = state.preferences.server;
      }
      // Cast to fix type error after if check above
      const serverInfo = state.serviceInfo.server.find(s => s.name === server || s.aliases.includes(server as string));
      if (serverInfo) {
        // Found server info, safely stop the server if it's not the correct one, then run the correct one
        const runningServer = state.services.get('server');
        if (!runningServer || !('name' in runningServer.info) || runningServer.info.name !== serverInfo.name) {
          if (runningServer) {
            // Wrong server running, stop it
            await removeService(state, 'server');
          }
          // Start the correct server
          log.debug('Launcher', `Changing server to: ${serverInfo.name}`);
          state.services.delete('server');
          runService(state, 'server', 'Server', state.config.flashpointPath, {env: {
            ...process.env,
            'PATH': state.pathVar ?? process.env.PATH,
          }}, serverInfo);
        }
      } else {
        throw new Error(`Server '${server}' not found`);
      }
    }
  };
}

/**
 * Exits the Flashpoint Launcher safely
 *
 * @param state Back State
 * @param beforeProcessExit Function to call right before process exit
 */
export async function exitApp(state: BackState, beforeProcessExit?: () => void | Promise<void>) {
  return exit(state, beforeProcessExit);
}

function makeFlatPlatforms(platforms: Platform[]): string[] {
  return platforms.reduce<string[]>((prev, cur) => prev.concat(cur.aliases.map(a => a.name)), []);
}

async function downloadGameData(state: BackState, gameData: GameData) {
  const onDetails = (details: DownloadDetails) => {
    state.socketServer.broadcast(BackOut.SET_PLACEHOLDER_DOWNLOAD_DETAILS, details);
  };
  const onProgress = (percent: number) => {
    // Sent to PLACEHOLDER download dialog on client
    state.socketServer.broadcast(BackOut.SET_PLACEHOLDER_DOWNLOAD_PERCENT, percent);
  };
  state.socketServer.broadcast(BackOut.OPEN_PLACEHOLDER_DOWNLOAD_DIALOG);
  try {
    await GameDataManager.downloadGameData(gameData.id, path.join(state.config.flashpointPath, state.preferences.dataPacksFolderPath), state.preferences.gameDataSources, state.downloadController.signal(), onProgress, onDetails);
  } finally {
    // Close PLACEHOLDER download dialog on client, cosmetic delay to look nice
    setTimeout(() => {
      state.socketServer.broadcast(BackOut.CLOSE_PLACEHOLDER_DOWNLOAD_DIALOG);
    }, 250);
  }
}

const unsafeParseJsonBuffer = <T>(buffer: Buffer): T => {
  const data = buffer.toString();
  return JSON.parse(data) as T;
};

// Download the JSON file from a URL and save it to a buffer
const downloadJsonDataToBuffer = async (url: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const data: Buffer[] = [];
      response.on('data', (chunk) => {
        data.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(data);
        resolve(buffer);
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
};
