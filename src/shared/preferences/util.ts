import { CurateGroup } from '@renderer/store/curate/types';
import { autoCode } from '@shared/lang';
import { LogLevel } from '@shared/Log/interface';
import { delayedThrottle, delayedThrottleAsync } from '@shared/utils/throttle';
import { AppPathOverride, AppPreferencesData, AppPreferencesDataMainWindow, GameDataSource, GameMetadataSource, TagFilterGroup } from 'flashpoint-launcher';
import { BackIn } from '../back/types';
import { BrowsePageLayout } from '../BrowsePageLayout';
import { ARCADE } from '../constants';
import { DeepPartial } from '../interfaces';
import { gameOrderByOptions, gameOrderReverseOptions } from '../order/util';
import { deepCopy, parseVarStr } from '../Util';
import * as Coerce from '@shared/utils/Coerce';
import { IObjectParserProp, ObjectParser } from '../utils/ObjectParser';

export function updatePreferencesData(data: DeepPartial<AppPreferencesData>, send = true) {
  const preferences = window.Shared.preferences;
  // @TODO Figure out the delta change of the object tree, and only send the changes
  preferences.data = overwritePreferenceData(deepCopy(preferences.data), data);
  if (send) {
    sendPrefs();
  }
  if (preferences.onUpdate) { preferences.onUpdate(); }
}

export async function updatePreferencesDataAsync(data: DeepPartial<AppPreferencesData>, send = true) {
  const preferences = window.Shared.preferences;
  // @TODO Figure out the delta change of the object tree, and only send the changes
  preferences.data = overwritePreferenceData(deepCopy(preferences.data), data);
  if (send) {
    await sendPrefsAsync();
  }
  if (preferences.onUpdate) { preferences.onUpdate(); }
}

const sendPrefs = delayedThrottle(() => {
  const preferences = window.Shared.preferences;
  window.Shared.back.send(
    BackIn.UPDATE_PREFERENCES,
    preferences.data,
    false
  );
}, 200);

const sendPrefsAsync = delayedThrottleAsync(async () => {
  const preferences = window.Shared.preferences;
  await window.Shared.back.request(
    BackIn.UPDATE_PREFERENCES,
    preferences.data,
    false
  );
}, 200);

const { num, str } = Coerce;

/** Default Preferences Data used for values that are not found in the file */
export const defaultPreferencesData: Readonly<AppPreferencesData> = Object.freeze<AppPreferencesData>({
  imageFolderPath: 'Data/Images',
  logoFolderPath: 'Data/Logos',
  playlistFolderPath: 'Data/Playlists',
  jsonFolderPath: 'Data',
  htdocsFolderPath: 'Legacy/htdocs',
  platformFolderPath: 'Data/Platforms',
  themeFolderPath: 'Data/Themes',
  logoSetsFolderPath: 'Data/LogoSets',
  metaEditsFolderPath: 'Data/MetaEdits',
  extensionsPath: 'Data/Extensions',
  dataPacksFolderPath: 'Data/Games',
  browsePageGameScale: 0.087,
  browsePageShowExtreme: false,
  enableEditing: true,
  fallbackLanguage: 'en',
  currentLanguage: autoCode,
  browsePageLayout: BrowsePageLayout.list,
  browsePageShowLeftSidebar: true,
  browsePageShowRightSidebar: true,
  browsePageLeftSidebarWidth: 320,
  browsePageRightSidebarWidth: 320,
  curatePageLeftSidebarWidth: 320,
  showDeveloperTab: false,
  currentTheme: 'Metal\\theme.css',
  currentLogoSet: undefined,
  lastSelectedLibrary: '',
  gamesOrderBy: 'title',
  gamesOrder: 'ASC',
  defaultLibrary: ARCADE,
  mainWindow: Object.freeze({
    x: undefined,
    y: undefined,
    width: undefined,
    height: undefined,
    maximized: false,
  }),
  saveImportedCurations: true,
  keepArchiveKey: true,
  symlinkCurationContent: true,
  onDemandImages: true,
  onDemandImagesCompressed: true,
  onDemandBaseUrl: 'https://infinity.unstable.life/images/',
  browserModeProxy: 'localhost:22500',
  showLogSource: Object.freeze({
    // (Add log sources that should be hidden by default here)
  }),
  showLogLevel: Object.freeze({
    [LogLevel.TRACE]: false,
    [LogLevel.DEBUG]: false,
    [LogLevel.INFO]: true,
    [LogLevel.WARN]: true,
    [LogLevel.ERROR]: true,
    [LogLevel.SILENT]: true,
  }),
  excludedRandomLibraries: [],
  appPathOverrides: [],
  tagFilters: [],
  tagFiltersInCurate: false,
  nativePlatforms: [],
  disableExtremeGames: false,
  showBrokenGames: false,
  minimizedHomePageBoxes: [],
  hideExtremeScreenshots: true,
  updateFeedUrl: 'https://bluemaxima.org/flashpoint/updateFeed/stable.txt',
  fancyAnimations: true,
  searchLimit: 0,
  onlineManual: 'https://flashpointproject.github.io/manual/',
  offlineManual: '',
  fpfssBaseUrl: 'https://fpfss.unstable.life',
  groups: [],
  server: 'Apache Webserver',
  curateServer: 'Apache Webserver',
  shortcuts: {
    curate: {
      prev: ['ctrl+arrowup', 'cmd+arrowup'],
      next: ['ctrl+arrowdown', 'cmd+arrowdown'],
      load: ['ctrl+o', 'cmd+o'],
      newCur: ['ctrl+n', 'cmd+n'],
      deleteCurs: ['ctrl+delete', 'cmd+delete'],
      exportCurs: ['ctrl+s', 'cmd+s'],
      exportDataPacks: ['ctrl+shift+s', 'cmd+shift+s'],
      importCurs: ['ctrl+i', 'cmd+i'],
      refresh: ['ctrl+r', 'cmd+r'],
      run: ['ctrl+t', 'cmd+t'],
      runMad4fp: ['ctrl+shift+t', 'cmd+shift+t']
    }
  },
  gameDataSources: [],
  gameMetadataSources: [],
});

/**
 * Overwrite a preferences data object with data from another object.
 *
 * @param source Object to overwrite.
 * @param data Object with data to overwrite the source with.
 * @param onError Called when an error occurs
 * @returns Source argument (not a copy).
 */
export function overwritePreferenceData(
  source: AppPreferencesData,
  data: DeepPartial<AppPreferencesData>,
  onError?: (error: string) => void
): AppPreferencesData {
  const parser = new ObjectParser({
    input: data,
    onError: onError && (e => onError(`Error while parsing Preferences: ${e.toString()}`)),
  });
  // Parse root object
  parser.prop('imageFolderPath',             v => source.imageFolderPath             = parseVarStr(str(v)));
  parser.prop('logoFolderPath',              v => source.logoFolderPath              = parseVarStr(str(v)));
  parser.prop('playlistFolderPath',          v => source.playlistFolderPath          = parseVarStr(str(v)));
  parser.prop('jsonFolderPath',              v => source.jsonFolderPath              = parseVarStr(str(v)));
  parser.prop('htdocsFolderPath',            v => source.htdocsFolderPath            = parseVarStr(str(v)));
  parser.prop('platformFolderPath',          v => source.platformFolderPath          = parseVarStr(str(v)));
  parser.prop('themeFolderPath',             v => source.themeFolderPath             = parseVarStr(str(v)));
  parser.prop('logoSetsFolderPath',          v => source.logoSetsFolderPath          = parseVarStr(str(v)));
  parser.prop('metaEditsFolderPath',         v => source.metaEditsFolderPath         = parseVarStr(str(v)));
  parser.prop('extensionsPath',              v => source.extensionsPath              = parseVarStr(str(v)));
  parser.prop('dataPacksFolderPath',         v => source.dataPacksFolderPath         = parseVarStr(str(v)));
  parser.prop('browsePageGameScale',         v => source.browsePageGameScale         = num(v));
  parser.prop('browsePageShowExtreme',       v => source.browsePageShowExtreme       = !!v);
  parser.prop('hideExtremeScreenshots',      v => source.hideExtremeScreenshots      = !!v);
  parser.prop('enableEditing',               v => source.enableEditing               = !!v);
  parser.prop('fallbackLanguage',            v => source.fallbackLanguage            = str(v));
  parser.prop('currentLanguage',             v => source.currentLanguage             = str(v));
  parser.prop('browsePageLayout',            v => source.browsePageLayout            = num(v));
  parser.prop('browsePageShowLeftSidebar',   v => source.browsePageShowLeftSidebar   = !!v);
  parser.prop('browsePageShowRightSidebar',  v => source.browsePageShowRightSidebar  = !!v);
  parser.prop('browsePageLeftSidebarWidth',  v => source.browsePageLeftSidebarWidth  = num(v));
  parser.prop('browsePageRightSidebarWidth', v => source.browsePageRightSidebarWidth = num(v));
  parser.prop('curatePageLeftSidebarWidth',  v => source.curatePageLeftSidebarWidth  = num(v));
  parser.prop('showDeveloperTab',            v => source.showDeveloperTab            = !!v);
  parser.prop('currentTheme',                v => source.currentTheme                = str(v), true);
  parser.prop('lastSelectedLibrary',         v => source.lastSelectedLibrary         = str(v));
  parser.prop('gamesOrderBy',                v => source.gamesOrderBy                = strOpt(v, gameOrderByOptions,      'title'    ));
  parser.prop('gamesOrder',                  v => source.gamesOrder                  = strOpt(v, gameOrderReverseOptions, 'ASC'));
  parser.prop('defaultLibrary',              v => source.defaultLibrary              = str(v));
  parser.prop('saveImportedCurations',       v => source.saveImportedCurations       = !!v);
  parser.prop('keepArchiveKey',              v => source.keepArchiveKey              = !!v);
  parser.prop('symlinkCurationContent',      v => source.symlinkCurationContent      = !!v);
  parser.prop('tagFiltersInCurate',          v => source.tagFiltersInCurate          = !!v);
  parser.prop('onDemandImages',              v => source.onDemandImages              = !!v);
  parser.prop('onDemandImagesCompressed',    v => source.onDemandImagesCompressed    = !!v);
  parser.prop('browserModeProxy',            v => source.browserModeProxy            = str(v));
  parser.prop('onDemandBaseUrl',             v => source.onDemandBaseUrl             = parseVarStr(str(v)));
  parser.prop('excludedRandomLibraries',     v => source.excludedRandomLibraries     = strArray(v), true);
  parser.prop('minimizedHomePageBoxes',      v => source.minimizedHomePageBoxes      = strArray(v), true);
  parser.prop('nativePlatforms',             v => source.nativePlatforms             = strArray(v));
  parser.prop('disableExtremeGames',         v => source.disableExtremeGames         = !!v);
  parser.prop('showBrokenGames',             v => source.showBrokenGames             = !!v);
  parser.prop('updateFeedUrl',               v => source.updateFeedUrl               = str(v));
  parser.prop('onlineManual',                v => source.onlineManual                = str(v));
  parser.prop('offlineManual',               v => source.offlineManual               = str(v));
  parser.prop('fpfssBaseUrl',                v => source.fpfssBaseUrl                = str(v));
  parser.prop('fancyAnimations',             v => source.fancyAnimations             = !!v);
  parser.prop('searchLimit',                 v => source.searchLimit                 = num(v));
  parser.prop('server',                      v => source.server                      = str(v));
  parser.prop('curateServer',                v => source.curateServer                = str(v));
  // Migrate onDemandBaseUrl from the older FP url
  if (source.onDemandBaseUrl == 'https://infinity.unstable.life/Flashpoint/Data/Images/') {
    source.onDemandBaseUrl = 'https://infinity.unstable.life/images/';
  }
  if (data.shortcuts) {
    // @TODO Validate
    source.shortcuts = Object.assign(source.shortcuts, data.shortcuts);
  }
  if (data.groups) {
    const newGroups: CurateGroup[] = [];
    parser.prop('groups').array((item, index) => newGroups[index] = parseCurateGroup(item));
    source.groups = newGroups;
  }
  if (data.appPathOverrides) {
    const newAppPathOverrides: AppPathOverride[] = [];
    parser.prop('appPathOverrides').array((item, index) => newAppPathOverrides[index] = parseAppPathOverride(item));
    source.appPathOverrides = newAppPathOverrides;
  }
  // Parse window object
  parseMainWindow(parser.prop('mainWindow'), source.mainWindow);
  parser.prop('showLogSource').mapRaw((item, label) => source.showLogSource[label] = !!item);
  parser.prop('showLogLevel').mapRaw((item, label) => source.showLogLevel[label as LogLevel] = !!item);
  parser.prop('currentLogoSet',              v => source.currentLogoSet              = str(v), true);
  if (data.tagFilters) {
    // Why is this or undefined anyway?
    const newTagFilters: TagFilterGroup[] = [];
    parser.prop('tagFilters').array((item, index) => newTagFilters[index] = parseTagFilterGroup(item as IObjectParserProp<TagFilterGroup>));
    source.tagFilters = newTagFilters;
  }
  if (data.gameDataSources) {
    const newSources: GameDataSource[] = [];
    parser.prop('gameDataSources').array((item, index) => newSources[index] = parseGameDataSource(item as IObjectParserProp<GameDataSource>));
    source.gameDataSources = newSources;
  }
  if (data.gameMetadataSources) {
    const newSources: GameMetadataSource[] = [];
    parser.prop('gameMetadataSources').array((item, index) => newSources[index] = parseGameMetadataSource(item as IObjectParserProp<GameMetadataSource>));
    source.gameMetadataSources = newSources;
  }
  // Done
  return source;
}

function parseMainWindow(parser: IObjectParserProp<any>, output: AppPreferencesDataMainWindow): void {
  parser.prop('x',         v => output.x         = num(v), true);
  parser.prop('y',         v => output.y         = num(v), true);
  parser.prop('width',     v => output.width     = num(v), true);
  parser.prop('height',    v => output.height    = num(v), true);
  parser.prop('maximized', v => output.maximized = !!v);
}

function parseAppPathOverride(parser: IObjectParserProp<any>): AppPathOverride {
  const override: AppPathOverride = {
    path: '',
    override: '',
    enabled: true
  };
  parser.prop('path',     v => override.path     = str(v));
  parser.prop('override', v => override.override = str(v));
  parser.prop('enabled',  v => override.enabled  = !!v);
  return override;
}

function parseGameDataSource(parser: IObjectParserProp<GameDataSource>): GameDataSource {
  const source: GameDataSource = {
    type: 'raw',
    name: '',
    arguments: []
  };
  parser.prop('type', v => source.type = str(v));
  parser.prop('name', v => source.name = str(v));
  parser.prop('arguments').arrayRaw((item, index) => source.arguments.push(item));
  return source;
}

function parseGameMetadataSource(parser: IObjectParserProp<GameMetadataSource>): GameMetadataSource {
  const source: GameMetadataSource = {
    name: '',
    baseUrl: '',
    lastUpdatedTags: '1970-01-01',
    lastUpdatedGames: '1970-01-01',
  };
  parser.prop('name',             v => source.name             = str(v));
  parser.prop('baseUrl',          v => source.baseUrl          = str(v));
  parser.prop('lastUpdatedTags',  v => source.lastUpdatedTags  = str(v), true);
  parser.prop('lastUpdatedGames', v => source.lastUpdatedGames = str(v), true);
  return source;
}

function parseTagFilterGroup(parser: IObjectParserProp<TagFilterGroup>): TagFilterGroup {
  const tfg: TagFilterGroup = {
    name: '',
    description: '',
    enabled: false,
    tags: [],
    categories: [],
    childFilters: [],
    extreme: false
  };
  parser.prop('name',    v => tfg.name    = str(v));
  parser.prop('description', v => tfg.description = str(v));
  parser.prop('enabled', v => tfg.enabled = !!v);
  parser.prop('tags').arrayRaw((item) => tfg.tags.push(str(item)));
  parser.prop('categories').arrayRaw((item) => tfg.categories.push(str(item)));
  parser.prop('childFilters').arrayRaw((item) => tfg.childFilters.push(str(item)));
  parser.prop('extreme', v => tfg.extreme = !!v);
  return tfg;
}

function parseCurateGroup(parser: IObjectParserProp<any>): CurateGroup {
  const g: CurateGroup = {
    name: '',
    icon: ''
  };
  parser.prop('name', v => g.name = str(v));
  parser.prop('icon', v => g.icon = str(v));
  return g;
}

/**
 * Coerce a value to a string, then return it if it matches at least on of the options.
 * If it does not match any option, the default option is returned.
 *
 * @param value Value to coerce.
 * @param options Options the value must match at least one of.
 * @param defaultOption This is returned if the value doesn't match any of the options.
 */
function strOpt<T extends string>(value: any, options: T[], defaultOption: T): T {
  value = str(value);
  for (const option of options) {
    if (value === option) { return value; }
  }
  return defaultOption;
}

function strArray(array: any): string[] {
  return Array.isArray(array)
    ? Array.prototype.map.call(array, v => str(v)) as string[]
    : [];
}
