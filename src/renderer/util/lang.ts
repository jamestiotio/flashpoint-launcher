import * as React from 'react';
import { LangContainer } from '../../shared/lang/types';

export const LangContext = React.createContext(getDefaultLocalization());

export function getDefaultLocalization(): LangContainer {
  return {
    config: {
      configHeader: 'configHeader',
      configDesc: 'configDesc',
      extremeGames: 'extremeGames',
      extremeGamesDesc: 'extremeGamesDesc',
      preferencesHeader: 'preferencesHeader',
      enableEditing: 'enableEditing',
      enableEditingDesc: 'enableEditingDesc',
      currentLanguage: 'currentLanguage',
      currentLanguageDesc: 'currentLanguageDesc',
      fallbackLanguage: 'fallbackLanguage',
      fallbackLanguageDesc: 'fallbackLanguageDesc',
      auto: 'auto ({0})',
      none: 'none',
      flashpointHeader: 'flashpointHeader',
      flashpointPath: 'flashpointPath',
      flashpointPathDesc: 'flashpointPathDesc',
      redirector: 'redirector',
      redirectorFiddler: 'redirectorFiddler',
      redirectorDesc: 'redirectorDesc',
      useWine: 'useWine',
      useWineDesc: 'useWineDesc',
      platforms: 'platforms',
      nativeLocks: 'nativeLocks',
      nativeLocksDesc: 'nativeLocksDesc',
      visualsHeader: 'visualsHeader',
      useCustomTitleBar: 'useCustomTitleBar',
      useCustomTitleBarDesc: 'useCustomTitleBarDesc',
      theme: 'theme',
      noTheme: 'noTheme',
      themeDesc: 'themeDesc',
      advancedHeader: 'advancedHeader',
      showDeveloperTab: 'showDeveloperTab',
      showDeveloperTabDesc: 'showDeveloperTabDesc',
      saveAndRestart: 'saveAndRestart',
      browse: 'browse',
    },
    home: {
      quickStartHeader: 'quickStartHeader',
      hallOfFameInfo: 'hallOfFameInfo {0}',
      hallOfFame: 'hallOfFame',
      allGamesInfo: 'allGamesInfo {0}',
      allGames: 'allGames',
      allAnimationsInfo: 'allAnimationsInfo {0}',
      allAnimations: 'allAnimations',
      configInfo: 'configInfo {0}',
      config: 'config',
      helpInfo: 'helpInfo {0}',
      help: 'help',
      upgradesHeader: 'upgradesHeader',
      installComplete: 'installComplete',
      alreadyInstalled: 'alreadyInstalled',
      download: 'download',
      extrasHeader: 'extrasHeader',
      favoritesPlaylist: 'favoritesPlaylist',
      genreList: 'genreList',
      filterByPlatform: 'filterByPlatform',
      plannedFeatures: 'plannedFeatures',
      notesHeader: 'notesHeader',
      notes: 'notes',
      linuxSupport: 'linuxSupport {0}',
      linuxSupportLinkText: 'linuxSupportLinkText',
      randomPicks: 'randomPicks',
    },
    logs:{
      filters: 'filters',
      copyText: 'copyText',
      clearLog: 'clearLog',
    },
    app:{
      home: 'home',
      browse: 'browse',
      logs: 'logs',
      config: 'config',
      about: 'about',
      curate: 'curate',
      developer: 'developer',
      searchPlaceholder: 'searchPlaceholder',
      hideRightSidebar: 'hideRightSidebar',
      showRightSidebar: 'showRightSidebar',
      hideLeftSidebar: 'hideLeftSidebar',
      showLeftSidebar: 'showLeftSidebar',
      total: 'total',
      newGame: 'newGame',
      list: 'list',
      grid: 'grid'
    },
    filter:{
      dateAdded: 'dateAdded',
      genre: 'genre',
      platform: 'platform',
      series: 'series',
      title: 'title',
      ascending: 'ascending',
      descending: 'descending',
      developer: 'developer'
    },
    developer:{
      developerHeader: 'developerHeader',
      developerDesc: 'developerDesc',
      checkMissingImages: 'checkMissingImages',
      checkMissingImagesDesc: 'checkMissingImagesDesc',
      checkGameIds: 'checkGameIds',
      checkGameIdsDesc: 'checkGameIdsDesc',
      checkGameTitles: 'checkGameTitles',
      checkGameTitlesDesc: 'checkGameTitlesDesc',
      checkGameFields: 'checkGameFields',
      checkGameFieldsDesc: 'checkGameFieldsDesc',
      checkPlaylists: 'checkPlaylists',
      checkPlaylistsDesc: 'checkPlaylistsDesc',
      checkGameFileLocation: 'checkGameFileLocation',
      checkGameFileLocationDesc: 'checkGameFileLocationDesc',
      checkMissingExecMappings: 'checkMissingExecMappings',
      checkMissingExecMappingsDesc: 'checkMissingExecMappingsDesc',
      renameImagesIdToTitle: 'renameImagesIdToTitle',
      renameImagesIdToTitleDesc: 'renameImagesIdToTitleDesc',
      renameImagesTitleToId: 'renameImagesTitleToId',
      renameImagesTitleToIdDesc: 'renameImagesTitleToIdDesc',
      createMissingFolders: 'createMissingFolders',
      createMissingFoldersDesc: 'createMissingFolderDesc'
    },
    about:{
      aboutHeader: 'aboutHeader',
      flashpoint: 'flashpoint',
      flashpointDesc: 'flashpointDesc',
      website: 'website',
      flashpointLauncher: 'flashpointLauncher',
      flashpointLauncherDesc: 'flashpointLauncherDesc',
      version: 'version',
      license: 'license',
      licenseInfo: 'licenseInfo',
      creditsHeader: 'creditsHeader'
    },
    browse:{
      noTitle: 'noTitle',
      by: 'by',
      noDeveloper: 'noDeveloper',
      genre: 'genre',
      noGenre: 'noGenre',
      series: 'series',
      noSeries: 'noSeries',
      publisher: 'publisher',
      noPublisher: 'noPublisher',
      source: 'source',
      noSource: 'noSource',
      platform: 'platform',
      noPlatform: 'noPlatform',
      playMode: 'playMode',
      noPlayMode: 'noPlaymode',
      status: 'status',
      noStatus: 'noStatus',
      version: 'version',
      noVersion: 'noVersion',
      releaseDate: 'releaseDate',
      noReleaseDate: 'noReleaseDate',
      language: 'language',
      noLanguage: 'noLanguage',
      dateAdded: 'dateAdded',
      brokenInInfinity: 'brokenInInfinity',
      extreme: 'extreme',
      playlistNotes: 'playlistNotes',
      noPlaylistNotes: 'noPlaylistNotes',
      notes: 'notes',
      noNotes: 'noNotes',
      originalDescription: 'originalDescription',
      noOriginalDescription: 'noOriginalDescription',
      additionalApplications: 'additionalApplications',
      noName: 'noName',
      launch: 'launch',
      new: 'new',
      commandLine: 'commandLine',
      noCommandLine: 'noCommandLine',
      autoRunBefore: 'autoRunBefore',
      waitForExit: 'waitForExit',
      applicationPath: 'applicationPath',
      noApplicationPath: 'noApplicationPath',
      launchCommand: 'launchCommand',
      noLaunchCommand: 'noLaunchCommand',
      thumbnail: 'thumbnail',
      screenshot: 'screenshot',
      dropImageHere: 'dropImageHere',
      noGameSelected: 'noGameSelected',
      clickToSelectGame: 'clickToSelectGame',
      failedToLoadPlaylistFolder: 'failedToLoadPlaylistFolder',
      checkLogForInfo: 'checkLogForInfo',
      loadingPlaylists: 'loadingPlaylists',
      deleteAdditionalApplication: 'deleteAdditionalApplication',
      deleteGameAndAdditionalApps: 'deleteGameAndAdditionalApps',
      removeGameFromPlaylist: 'removeGameFromPlaylist',
      saveChanges: 'saveChanges',
      discardChanges: 'discardChanges',
      editGame: 'editGame',
      allGames: 'allGames',
      newPlaylist: 'newPlaylist',
      emptyPlaylist: 'emptyPlaylist',
      noGamesFound: 'noGamesFound',
      dropGameOnLeft: 'dropGameOnLeft {0}',
      leftSidebar: 'leftSidebar',
      setFlashpointPathQuestion: 'setFlashpointPathQuestion {0} {1}',
      flashpointPath: 'flashpointPath',
      config: 'config',
      noteSaveAndRestart: 'noteSaveAndRestart {0}',
      saveAndRestart: 'saveAndRestart',
      loadingGames: 'loadingGames',
      noGameMatchedDesc: 'noGameMatchedDesc',
      noGameMatchedSearch: 'noGameMatchedSearch',
      thereAreNoGames: 'thereAreNoGames'
    },
    curate:{
      importAll: 'importAll',
      importAllDesc: 'importAllDesc',
      loadMeta: 'loadMeta',
      loadMetaDesc: 'loadMetaDesc',
      loadArchive: 'loadArchive',
      loadArchiveDesc: 'loadArchiveDesc',
      loadFolder: 'loadFolder',
      loadFolderDesc: 'loadFolderDesc',
      heading: 'heading',
      noHeading: 'noHeading',
      curationNotes: 'curationNotes',
      noCurationNotes: 'noCurationNotes',
      remove: 'remove',
      removeCurationDesc: 'removeCurationDesc',
      import: 'import',
      contentFiles: 'contentFiles',
      warnings: 'warnings',
      isNotHttp: 'isNotHttp',
      releaseDateInvalid: 'releaseDateInvalid',
      unusedApplicationPath: 'unusedApplicationPath',
      unusedGenre: 'unusedGenre',
      unusedPlatform: 'unusedPlatform',
      noContent: 'noContent'
    },
    playlist:{
      enterDescriptionHere: 'enterDescriptionHere',
      noDescription: 'noDescription',
      save: 'save',
      saveDesc: 'saveDesc',
      discard: 'discard',
      discardDesc: 'discardDesc',
      edit: 'edit',
      editDesc: 'editDesc',
      delete: 'delete',
      deleteDesc: 'deleteDesc',
      areYouSure: 'areYouSure',
      noTitle: 'noTitle',
      titlePlaceholder: 'titlePlaceholder',
      noAuthor: 'noAuthor',
      authorPlaceholder: 'authorPlaceholder'
    },
    misc:{
      blankNotFound: '{0} blankNotFound',
      addBlank: 'addBlank {0}',
      removeBlank: 'removeBlank {0}',
      yes: 'yes',
      no: 'no',
      deleteAllBlankImages: 'deleteAllBlankImages {0}',
    },
    menu:{
      viewThumbnailInFolder: 'viewThumbnailInFolder',
      viewScreenshotInFolder: 'viewScreenshotInFolder',
      openFileLocation: 'openFileLocation',
      duplicateMetaOnly: 'duplicateMetaOnly',
      duplicateMetaAndImages: 'duplicateMetaAndImages',
      exportMetaOnly: 'exportMetaOnly',
      exportMetaAndImages: 'exportMetaAndImages'
    },
    dialog:{
      programNotFound: 'programNotFound',
      phpNotFound: 'phpNotFound',
      wineNotFound: 'wineNotFound',
      fileNotFound: 'fileNotFound',
      pathNotFound: 'pathNotFound',
      selectFileToExportMeta: 'selectFileToExportMeta',
      selectFolderToExportMetaAndImages: 'selectFolderToExportMetaAndImages',
      replaceFilesQuestion: 'replaceFilesQuestions',
      exportedAlreadyExistsYesNo: 'exportedAlreadyExistsYesNo',
      selectScreenshot: 'selectScreenshot',
      selectThumbnail: 'selectThumbnail',
      selectThemeFile: 'selectThemeFile',
      selectCurationFolder: 'selectCurationFolder',
      selectCurationArchive: 'selectCurationArchive',
      selectCurationMeta: 'selectCurationMeta',
    },
    libraries: {},
  };
}
