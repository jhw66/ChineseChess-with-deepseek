import {
  BLACK,
  RED,
  START_FEN,
  applyMove,
  boardToFen,
  cloneBoard,
  countPieces,
  createEmptyBoard,
  gameStatus,
  generateLegalMoves,
  isLegalMove,
  isGeneralInCheck,
  moveDescription,
  moveToUci,
  opposite,
  parseFen,
  pieceName,
  pieceSide,
  uciToMove,
  validatePosition,
} from "/src/xiangqi.js";
import { ENDGAME_PRESETS } from "/src/presets.js";
import {
  boardPointToDisplay,
  displayPointToBoard,
} from "/src/board-orientation.js";
import {
  createGameRecord,
  parseGameRecord,
  serializeGameRecord,
} from "/src/game-record.js";
import { formatMoveNotation } from "/src/xiangqi-notation.js";
import { selectHintMove } from "/src/hint.js";
import {
  DEFAULT_THINK_MS,
  MAX_THINK_MS,
  MIN_THINK_MS,
  clampThinkTime,
  ponderHitDecision,
  resolveForecastScoutMs,
  resolvePersonaThinkMs,
  supportsPonder,
} from "/src/think-time.js";
import {
  CUSTOM_MAP_STORAGE_KEY,
  DIFFICULTY_LIMITS,
  DIFFICULTY_SLOT_IDS,
  FREE_MODE_STORAGE_KEY,
  applyPersonaOverrides,
  defaultCustomization,
  hasCustomization,
  normalizeCustomizationMap,
  normalizeDifficultyCustomization,
  sliderToThinkMs,
  thinkMsToSlider,
} from "/src/difficulty.js";
import {
  assessVisionMatrix,
  enginePositionForState,
  normalizeVisionMatrix,
  visionMatrixToFen,
} from "/src/position-tools.js";
import {
  PERSONA_LIST,
  PERSONA_TRAITS,
  getControllerDecision,
  getMovePhase,
  getPersona,
  normalizeController,
  normalizePersonaTraits,
  resolvePersona,
} from "/src/persona.js";
import {
  createGameExport,
  parseGameTransfer,
  replayGame,
  serializeGameExport,
} from "/src/game-transfer.js";
import {
  REVIEW_MOVETIME_MS,
  calculateMoveLoss,
  classifyMove,
  gradeColor,
  gradeLabel,
  runReviewAnalysis,
  summarizeReview,
} from "/src/review-core.js";
import {
  MISTAKE_STATUS,
  addMistakes,
  evaluateTrainingAnswer,
  extractMistakesFromReview,
  loadMistakeBook,
  loadTrainingStats,
  markMistakeMastered,
  masteredToday,
  pickTrainingQuestion,
  recordTrainingAttempt,
  trainingAccuracy,
} from "/src/mistake-book.js";
import {
  VOICE_PRIORITY,
  VoiceOutputQueue,
} from "/src/voice-output.js";
import {
  ENGINE_THINK_MODES,
  LOW_POWER_SETTINGS,
  collectResourceWarnings,
  normalizeEngineThinkMode,
  normalizeResourceSettings,
  thinkModePolicy,
} from "/src/think-mode.js";

const elements = {
  board: document.querySelector("#board"),
  boardGuides: document.querySelector("#boardGuides"),
  boardPieces: document.querySelector("#boardPieces"),
  cpuSummary: document.querySelector("#cpuSummary"),
  engineBadge: document.querySelector("#engineBadge"),
  engineStateText: document.querySelector("#engineStateText"),
  settingsToggleBtn: document.querySelector("#settingsToggleBtn"),
  settingsToggleLabel: document.querySelector("#settingsToggleLabel"),
  exitBtn: document.querySelector("#exitBtn"),
  turnTitle: document.querySelector("#turnTitle"),
  gameStateChip: document.querySelector("#gameStateChip"),
  hintToggleBtn: document.querySelector("#hintToggleBtn"),
  hintToggleLabel: document.querySelector("#hintToggleLabel"),
  hintBanner: document.querySelector("#hintBanner"),
  hintMoveText: document.querySelector("#hintMoveText"),
  flipBoardBtn: document.querySelector("#flipBoardBtn"),
  focusViewBtn: document.querySelector("#focusViewBtn"),
  focusViewLabel: document.querySelector("#focusViewLabel"),
  globalFullscreenBtn: document.querySelector("#globalFullscreenBtn"),
  globalFullscreenLabel: document.querySelector("#globalFullscreenLabel"),
  lastMoveText: document.querySelector("#lastMoveText"),
  pieceCountText: document.querySelector("#pieceCountText"),
  moveCountText: document.querySelector("#moveCountText"),
  lastMoveEvaluation: document.querySelector("#lastMoveEvaluation"),
  lastMoveGrade: document.querySelector("#lastMoveGrade"),
  lastMoveSideLabel: document.querySelector("#lastMoveSideLabel"),
  lastMoveActual: document.querySelector("#lastMoveActual"),
  lastMoveBest: document.querySelector("#lastMoveBest"),
  lastMoveLoss: document.querySelector("#lastMoveLoss"),
  lastMoveHistory: document.querySelector("#lastMoveHistory"),
  lastMoveHistoryList: document.querySelector("#lastMoveHistoryList"),
  playTab: document.querySelector("#playTab"),
  editTab: document.querySelector("#editTab"),
  playPanel: document.querySelector("#playPanel"),
  editPanel: document.querySelector("#editPanel"),
  sideValue: document.querySelector("#sideValue"),
  humanSideValue: document.querySelector("#humanSideValue"),
  positionStateValue: document.querySelector("#positionStateValue"),
  matchModeSelect: document.querySelector("#matchModeSelect"),
  humanSideSelect: document.querySelector("#humanSideSelect"),
  personaSelect: document.querySelector("#personaSelect"),
  personaIntentSelect: document.querySelector("#personaIntentSelect"),
  personaTraitSettings: document.querySelector("#personaTraitSettings"),
  personaTraitList: document.querySelector("#personaTraitList"),
  personaControllerSettings: document.querySelector(
    "#personaControllerSettings",
  ),
  personaControllerCycle: document.querySelector("#personaControllerCycle"),
  personaControllerBest: document.querySelector("#personaControllerBest"),
  personaControllerAvoid: document.querySelector("#personaControllerAvoid"),
  personaControllerMinStreak: document.querySelector(
    "#personaControllerMinStreak",
  ),
  personaControllerMaxAvoid: document.querySelector(
    "#personaControllerMaxAvoid",
  ),
  personaControllerShuffle: document.querySelector(
    "#personaControllerShuffle",
  ),
  personaInfo: document.querySelector("#personaInfo"),
  personaDecision: document.querySelector("#personaDecision"),
  freeDifficultySettings: document.querySelector("#freeDifficultySettings"),
  freeDifficultyToggle: document.querySelector("#freeDifficultyToggle"),
  freeDifficultyStatus: document.querySelector("#freeDifficultyStatus"),
  difficultySlotList: document.querySelector("#difficultySlotList"),
  freeDifficultyPanel: document.querySelector("#freeDifficultyPanel"),
  freeDepthInput: document.querySelector("#freeDepthInput"),
  freeTopKInput: document.querySelector("#freeTopKInput"),
  freeTemperatureInput: document.querySelector("#freeTemperatureInput"),
  freeThinkInput: document.querySelector("#freeThinkInput"),
  resetDifficultySlotBtn: document.querySelector("#resetDifficultySlotBtn"),
  resetDifficultyAllBtn: document.querySelector("#resetDifficultyAllBtn"),
  startGameBtn: document.querySelector("#startGameBtn"),
  resetOpeningBtn: document.querySelector("#resetOpeningBtn"),
  engineMoveBtn: document.querySelector("#engineMoveBtn"),
  undoBtn: document.querySelector("#undoBtn"),
  saveRecordBtn: document.querySelector("#saveRecordBtn"),
  importRecordBtn: document.querySelector("#importRecordBtn"),
  recordFileInput: document.querySelector("#recordFileInput"),
  stopBtn: document.querySelector("#stopBtn"),
  stopBtnLabel: document.querySelector("#stopBtnLabel"),
  thinkTimeRange: document.querySelector("#thinkTimeRange"),
  thinkTimeInput: document.querySelector("#thinkTimeInput"),
  thinkTimeValue: document.querySelector("#thinkTimeValue"),
  threadsInput: document.querySelector("#threadsInput"),
  hashInput: document.querySelector("#hashInput"),
  multiPvInput: document.querySelector("#multiPvInput"),
  applySettingsBtn: document.querySelector("#applySettingsBtn"),
  resourceWarning: document.querySelector("#resourceWarning"),
  resetSystemParamsBtn: document.querySelector("#resetSystemParamsBtn"),
  depthValue: document.querySelector("#depthValue"),
  scoreValue: document.querySelector("#scoreValue"),
  npsValue: document.querySelector("#npsValue"),
  hashValue: document.querySelector("#hashValue"),
  pvText: document.querySelector("#pvText"),
  analysisStateChip: document.querySelector("#analysisStateChip"),
  coachPanel: document.querySelector("#coachPanel"),
  coachStateText: document.querySelector("#coachStateText"),
  coachReport: document.querySelector("#coachReport"),
  coachModeToggleBtn: document.querySelector("#coachModeToggleBtn"),
  coachManualModeBtn: document.querySelector("#coachManualModeBtn"),
  coachAutoModeBtn: document.querySelector("#coachAutoModeBtn"),
  coachAnalyzeBtn: document.querySelector("#coachAnalyzeBtn"),
  coachAnalyzeLastBtn: document.querySelector("#coachAnalyzeLastBtn"),
  freePlayToggleBtn: document.querySelector("#freePlayToggleBtn"),
  switchTurnBtn: document.querySelector("#switchTurnBtn"),
  continuousThinkingToggleBtn: document.querySelector(
    "#continuousThinkingToggleBtn",
  ),
  thinkModeSwitch: document.querySelector("#thinkModeSwitch"),
  thinkModeFocusBtn: document.querySelector("#thinkModeFocusBtn"),
  thinkModeDistractedBtn: document.querySelector("#thinkModeDistractedBtn"),
  lowPowerToggleBtn: document.querySelector("#lowPowerToggleBtn"),
  quipToggleBtn: document.querySelector("#quipToggleBtn"),
  deepseekApiKey: document.querySelector("#deepseekApiKey"),
  deepseekModel: document.querySelector("#deepseekModel"),
  quipVoiceEnabled: document.querySelector("#quipVoiceEnabled"),
  coachVoiceEnabled: document.querySelector("#coachVoiceEnabled"),
  voiceShareEnabled: document.querySelector("#voiceShareEnabled"),
  lanAccessHint: document.querySelector("#lanAccessHint"),
  speechRateInput: document.querySelector("#speechRateInput"),
  speechRateValue: document.querySelector("#speechRateValue"),
  voiceSelect: document.querySelector("#voiceSelect"),
  replayCommentaryBtn: document.querySelector("#replayCommentaryBtn"),
  testVoiceBtn: document.querySelector("#testVoiceBtn"),
  stopCommentaryBtn: document.querySelector("#stopCommentaryBtn"),
  resetAllSettingsBtn: document.querySelector("#resetAllSettingsBtn"),
  commentaryText: document.querySelector("#commentaryText"),
  clearBoardBtn: document.querySelector("#clearBoardBtn"),
  piecePalette: document.querySelector("#piecePalette"),
  editTurnSelect: document.querySelector("#editTurnSelect"),
  initialPositionBtn: document.querySelector("#initialPositionBtn"),
  endgamePresets: document.querySelector("#endgamePresets"),
  fenInput: document.querySelector("#fenInput"),
  loadFenBtn: document.querySelector("#loadFenBtn"),
  copyFenBtn: document.querySelector("#copyFenBtn"),
  deepseekVisionModel: document.querySelector("#deepseekVisionModel"),
  visionRefine: document.querySelector("#visionRefine"),
  visionImageInput: document.querySelector("#visionImageInput"),
  chooseVisionImageBtn: document.querySelector("#chooseVisionImageBtn"),
  recognizeVisionBtn: document.querySelector("#recognizeVisionBtn"),
  visionPreviewWrap: document.querySelector("#visionPreviewWrap"),
  visionPreview: document.querySelector("#visionPreview"),
  visionStatus: document.querySelector("#visionStatus"),
  visionReviewModal: document.querySelector("#visionReviewModal"),
  visionReviewCloseBtn: document.querySelector("#visionReviewCloseBtn"),
  visionReviewBoard: document.querySelector("#visionReviewBoard"),
  visionReviewTurn: document.querySelector("#visionReviewTurn"),
  visionReviewSummary: document.querySelector("#visionReviewSummary"),
  visionReviewMessages: document.querySelector("#visionReviewMessages"),
  visionReviewCancelBtn: document.querySelector("#visionReviewCancelBtn"),
  visionReviewConfirmBtn: document.querySelector("#visionReviewConfirmBtn"),
  reviewTab: document.querySelector("#reviewTab"),
  reviewPanel: document.querySelector("#reviewPanel"),
  reviewStateText: document.querySelector("#reviewStateText"),
  exportReviewBtn: document.querySelector("#exportReviewBtn"),
  importReviewBtn: document.querySelector("#importReviewBtn"),
  fixtureReviewBtn: document.querySelector("#fixtureReviewBtn"),
  reviewFileInput: document.querySelector("#reviewFileInput"),
  startReviewBtn: document.querySelector("#startReviewBtn"),
  cancelReviewBtn: document.querySelector("#cancelReviewBtn"),
  reviewProgressText: document.querySelector("#reviewProgressText"),
  reviewProgressPercent: document.querySelector("#reviewProgressPercent"),
  reviewProgressBar: document.querySelector("#reviewProgressBar"),
  reviewGoodCount: document.querySelector("#reviewGoodCount"),
  reviewInaccuracyCount: document.querySelector("#reviewInaccuracyCount"),
  reviewBlunderCount: document.querySelector("#reviewBlunderCount"),
  reviewMoveTree: document.querySelector("#reviewMoveTree"),
  reviewDetail: document.querySelector("#reviewDetail"),
  mistakeBookSummary: document.querySelector("#mistakeBookSummary"),
  trainingAttempts: document.querySelector("#trainingAttempts"),
  trainingAccuracy: document.querySelector("#trainingAccuracy"),
  trainingMasteredToday: document.querySelector("#trainingMasteredToday"),
  startTrainingBtn: document.querySelector("#startTrainingBtn"),
  endTrainingBtn: document.querySelector("#endTrainingBtn"),
  trainingQuestion: document.querySelector("#trainingQuestion"),
  trainingQuestionText: document.querySelector("#trainingQuestionText"),
  trainingStatus: document.querySelector("#trainingStatus"),
  toast: document.querySelector("#toast"),
};

// 复盘分析进行中需要临时禁用的控件。这里在脚本加载时一次性记录它们在 HTML 里的
// 初始 disabled 状态，作为"基线"；否则第一次调用时若正好处于忙碌态，就会把
// 临时禁用误存成基线，导致这些控件之后再也无法恢复可用。
const REVIEW_LOCKED_CONTROL_KEYS = [
  "startGameBtn",
  "resetOpeningBtn",
  "engineMoveBtn",
  "undoBtn",
  "editTab",
  "humanSideSelect",
  "personaSelect",
  "personaIntentSelect",
  "hintToggleBtn",
];
const reviewControlBaseline = new Map(
  REVIEW_LOCKED_CONTROL_KEYS.map((key) => [
    key,
    Boolean(elements[key]?.disabled),
  ]),
);

const initial = parseFen(START_FEN);
const APP_SETTINGS_KEY = "xiangqi.app.settings";
const state = {
  mode: "play",
  matchMode: "ai",
  board: cloneBoard(initial.board),
  turn: initial.turn,
  humanSide: BLACK,
  playStartFen: boardToFen(initial.board, initial.turn),
  moveHistory: [],
  history: [],
  personaId: "grandmaster",
  personaIntent: "persona",
  personaTraits: [],
  personaController: null,
  // 自由难度模式：9 个档位各自一份自定义参数，未自定义的档位不写存储。
  freeDifficulty: false,
  difficultyCustom: {},
  // 关闭自由难度后要恢复的普通模式思考时间。自由模式里的时间不会污染它。
  standardThinkTimeMs: 3000,
  personaHistory: [],
  personaDecision: null,
  lastMove: null,
  lastMoveSide: "",
  lastMoveText: "尚未走棋",
  selected: null,
  legalMoves: [],
  editPiece: "K",
  boardFlipped: false,
  thinkTimeMs: 3000,
  engineReady: false,
  engineThinking: false,
  analysisActive: false,
  analysisStarting: false,
  analysisPaused: false,
  pausedByVisibility: false,
  // 用户主动按【停止】造成的暂停：与"切后台自动暂停"区分开，
  // 只有用户再按一次【继续分析】或显式开启某个分析开关才会解除。
  userPaused: false,
  // 暂停期间被推迟的电脑走子：恢复分析时补走，避免棋局卡死。
  pendingEngineMove: false,
  continuousThinkingEnabled: false,
  // 超级大师的两档思考模式：focus=梁圣专注（全程预判），
  // distracted=梁子分心（玩家思考时释放 CPU，只在自己该走时搜索）。
  engineThinkMode: "focus",
  lowPowerMode: false,
  resourceBaseline: null,
  coachMode: false,
  coachAnalyzing: false,
  coachReportText: "",
  engineInfo: null,
  settingsOpen: false,
  // 专注视图（页面内全屏）与全局全屏（浏览器 Fullscreen API）互相独立。
  focusView: false,
  globalFullscreen: false,
  freePlay: false,
  freePlayStartFen: "",
  freeMoves: [],
  moveEvaluations: [],
  evaluationBusy: false,
  visionReview: null,
  gameStarted: false,
  quipEnabled: false,
  quipVoiceEnabled: true,
  // 跨设备语音同步：同一局域网里其它已打开页面的设备一起朗读同一句吐槽。
  voiceShareEnabled: true,
  coachTrigger: "manual",
  coachVoiceEnabled: true,
  speechRate: 1.5,
  lastCommentaryText: "",
  hintEnabled: false,
  hintMove: null,
  hintNotation: "",
  visionImageDataUrl: "",
  visionImageName: "",
  visionRecognizing: false,
  engineGeneration: 0,
  // 与 engineGeneration 分开：停止/暂停分析只作废"分析结果"，
  // 只有真正会改变局面的操作（悔棋/载入/编辑/重开）才作废在途的电脑走子。
  // 否则关掉持续思考或切到后台会让电脑那一步被静默丢弃，棋局卡死。
  moveGeneration: 0,
  // 预判续算（ponder）：只有"超级大师 + 持续思考"会用到。
  // 玩家思考期间引擎先在"对手最可能走出的那个子局面"上开着，
  // 玩家真的走了这一步就直接 ponderhit 继承搜索树与深度。
  pondering: false,
  forecastStarting: false,
  ponderMove: "",
  ponderReply: "",
  ponderNotation: "",
  ponderReplyNotation: "",
  ponderStartedAt: 0,
  ponderDepth: 0,
  ponderGeneration: 0,
  status: { state: "playing", reason: "" },
  system: null,
  reviewGame: null,
  reviewRecords: [],
  reviewResults: [],
  reviewRunning: false,
  reviewCancelled: false,
  reviewSelectedPly: 0,
  reviewArrows: [],
  reviewOriginalMode: "play",
  reviewOriginalGameStarted: false,
  reviewOriginalContinuous: false,
  reviewBoardSnapshot: null,
  trainingActive: false,
  trainingQuestion: null,
  trainingSelected: null,
  trainingLegalMoves: [],
  trainingBusy: false,
  trainingSnapshot: null,
};

let toastTimer = null;
const COMMENTARY_INITIAL_DELAY_MS = 2000;
const COMMENTARY_REPEAT_DELAY_MS = 10000;
let commentaryQueue = [];
let commentaryRunning = false;
let commentaryController = null;
let commentaryCurrentTask = null;
let commentaryGeneration = 0;
let analysisCommentaryTimer = null;
let lastCommentaryDeliveredAt = 0;
const voiceQueue = new VoiceOutputQueue({ maxQueue: 12 });
let activeSpeechItem = null;
let activeSpeechUtterance = null;
// 供"停止播报"中断正在进行的长语音（一句被切成多个短片时也要能整段停住）。
let activeSpeechCancel = null;
let speechWatchdogTimer = null;
// 每个页面一个随机 id：跨设备语音同步时用它区分"谁在说话"，避免回声。
const VOICE_CLIENT_ID = `voice-${Math.random().toString(36).slice(2, 10)}`;
// 谷歌浏览器对单条超长语音会在约 15 秒处截断，这里按句切成短片依次播放。
const SPEECH_CHUNK_MAX_CHARS = 90;
let speechUnlocked = false;
let continuousThinkingTimer = null;
// 低功耗/分心模式下不常驻 go infinite，提示改用"一次性有限搜索"，
// 这两个变量负责把过期的一次性搜索丢弃，避免旧结果盖住新局面的箭头。
let hintOnceTimer = null;
let hintOnceGeneration = 0;
let coachTypeTimer = null;
let coachAnalysisRunning = false;
let coachAnalysisQueue = [];
let coachAnalysisGeneration = 0;

const CONTINUOUS_THINKING_DEBOUNCE_MS = 150;
const MOVE_EVALUATION_MOVETIME_MS = 1200;
// 提示的一次性搜索时长：既要够准，又不能长时间占住 CPU。
const HINT_SEARCH_MOVETIME_MS = 1500;
const VISION_REVIEW_PIECES = [
  { value: ".", label: "空位" },
  { value: "K", label: "红帅" },
  { value: "A", label: "红仕" },
  { value: "B", label: "红相" },
  { value: "N", label: "红马" },
  { value: "R", label: "红车" },
  { value: "C", label: "红炮" },
  { value: "P", label: "红兵" },
  { value: "k", label: "黑将" },
  { value: "a", label: "黑士" },
  { value: "b", label: "黑象" },
  { value: "n", label: "黑马" },
  { value: "r", label: "黑车" },
  { value: "c", label: "黑炮" },
  { value: "p", label: "黑卒" },
];

function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type === "error" ? "error" : ""}`;
  toastTimer = setTimeout(() => {
    elements.toast.className = "toast";
  }, 2800);
}

function loadCommentarySettings() {
  let saved = {};
  try {
    saved = JSON.parse(
      localStorage.getItem("xiangqi.ai.settings") ||
        localStorage.getItem("xiangqi.deepseek.settings") ||
        "{}",
    );
  } catch {
    saved = {};
  }

  state.quipEnabled = Boolean(
    typeof saved.quipEnabled === "boolean" ? saved.quipEnabled : saved.enabled,
  );
  state.quipVoiceEnabled = saved.quipVoiceEnabled !== false;
  state.coachTrigger = saved.coachTrigger === "every-move"
    ? "every-move"
    : "manual";
  state.coachVoiceEnabled = saved.coachVoiceEnabled !== false;
  state.voiceShareEnabled = saved.voiceShareEnabled !== false;
  state.speechRate = clampNumberSetting(saved.speechRate, 1, 2.5, 1.5);
  elements.deepseekModel.value =
    typeof saved.model === "string" && saved.model.trim()
      ? saved.model
      : "deepseek-flash";
  elements.quipVoiceEnabled.checked = state.quipVoiceEnabled;
  elements.coachVoiceEnabled.checked = state.coachVoiceEnabled;
  elements.voiceShareEnabled.checked = state.voiceShareEnabled;
  elements.speechRateInput.value = String(state.speechRate);
  elements.speechRateValue.textContent = `${state.speechRate.toFixed(1)}×`;
  elements.voiceSelect.dataset.preferredVoice =
    typeof saved.voiceUri === "string" ? saved.voiceUri : "";
  let savedApiKey = "";
  try {
    savedApiKey =
      localStorage.getItem("xiangqi.deepseek.apiKey") ||
      sessionStorage.getItem("xiangqi.deepseek.apiKey") ||
      "";
    if (savedApiKey) {
      localStorage.setItem("xiangqi.deepseek.apiKey", savedApiKey);
    }
    sessionStorage.removeItem("xiangqi.deepseek.apiKey");
  } catch {}
  elements.deepseekApiKey.value = savedApiKey;
}

function saveCommentarySettings() {
  const settings = {
    quipEnabled: state.quipEnabled,
    quipVoiceEnabled: state.quipVoiceEnabled,
    coachTrigger: state.coachTrigger,
    coachVoiceEnabled: state.coachVoiceEnabled,
    voiceShareEnabled: state.voiceShareEnabled,
    speechRate: state.speechRate,
    model: elements.deepseekModel.value.trim() || "deepseek-flash",
    voiceUri: elements.voiceSelect.value,
  };
  try {
    localStorage.setItem(
      "xiangqi.ai.settings",
      JSON.stringify(settings),
    );
    localStorage.setItem(
      "xiangqi.deepseek.settings",
      JSON.stringify(settings),
    );
  } catch {
    // Settings can still be used for the current page without local storage.
  }
  try {
    localStorage.setItem(
      "xiangqi.deepseek.apiKey",
      elements.deepseekApiKey.value.trim(),
    );
  } catch {
    // The key remains available in the password field for this page.
  }
}

function populatePersonaOptions() {
  elements.personaSelect.innerHTML = "";
  for (const persona of PERSONA_LIST) {
    const option = document.createElement("option");
    option.value = persona.id;
    option.textContent = persona.name;
    option.title = persona.summary;
    elements.personaSelect.append(option);
  }
}

function traitWeight(trait) {
  return (
    activePersonaTraits().find((entry) => entry.trait === trait)?.weight ?? 0
  );
}

function renderPersonaTraits() {
  elements.personaTraitList.innerHTML = "";
  for (const trait of PERSONA_TRAITS) {
    const weight = traitWeight(trait.id);
    const row = document.createElement("label");
    row.className = "persona-trait-row";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = weight > 0;
    toggle.dataset.traitToggle = trait.id;
    toggle.setAttribute("aria-label", `启用${trait.name}`);

    const name = document.createElement("span");
    name.className = "persona-trait-name";
    name.textContent = trait.name;

    const value = document.createElement("input");
    value.type = "number";
    value.min = "0";
    value.max = "2";
    value.step = "0.1";
    value.value = weight > 0 ? String(weight) : "0.5";
    value.disabled = weight <= 0;
    value.dataset.traitWeight = trait.id;
    value.setAttribute("aria-label", `${trait.name}权重`);
    row.append(toggle, name, value);
    elements.personaTraitList.append(row);
  }
}

function readPersonaTraitsFromControls() {
  const entries = [];
  for (const trait of PERSONA_TRAITS) {
    const toggle = elements.personaTraitList.querySelector(
      `[data-trait-toggle="${trait.id}"]`,
    );
    const value = elements.personaTraitList.querySelector(
      `[data-trait-weight="${trait.id}"]`,
    );
    if (!toggle?.checked) continue;
    entries.push({
      trait: trait.id,
      weight: clampNumberSetting(value?.value, 0, 2, 0.5),
    });
  }
  return normalizePersonaTraits(entries);
}

function personaControllerDefaults(personaId = state.personaId) {
  if (state.freeDifficulty && personaId === state.personaId) {
    const customization = currentDifficultyCustomization();
    if (customization) {
      return normalizeController(customization.controller);
    }
  }
  return normalizeController(getPersona(personaId).controller);
}

function effectivePersonaController() {
  // 自由难度模式下，档位配置是唯一来源：全局人格调节器不参与，避免串档。
  const customization = currentDifficultyCustomization();
  if (customization) return normalizeController(customization.controller);
  return normalizeController({
    ...personaControllerDefaults(),
    ...(state.personaController ?? {}),
  });
}

function renderPersonaControllerSettings() {
  const persona = effectivePersona();
  const controller = effectivePersonaController();
  const isEngineBest = persona.mode === "engine_best";
  elements.personaControllerSettings.hidden = isEngineBest;
  elements.personaControllerCycle.value = String(controller.cycleN);
  elements.personaControllerBest.value = String(controller.bestCount);
  elements.personaControllerAvoid.value = String(controller.avoidCount);
  elements.personaControllerMinStreak.value = String(
    controller.minStreakBest,
  );
  elements.personaControllerMaxAvoid.value = String(
    controller.maxStreakAvoid,
  );
  elements.personaControllerShuffle.checked = controller.shuffle;
  for (const element of [
    elements.personaControllerCycle,
    elements.personaControllerBest,
    elements.personaControllerAvoid,
    elements.personaControllerMinStreak,
    elements.personaControllerMaxAvoid,
    elements.personaControllerShuffle,
  ]) {
    element.disabled = isEngineBest;
  }
  elements.personaControllerBest.max = String(controller.cycleN);
  elements.personaControllerAvoid.max = String(controller.cycleN);
  elements.personaControllerMinStreak.max = String(controller.cycleN);
  elements.personaControllerMaxAvoid.max = String(controller.cycleN);
}

function readPersonaControllerFromControls() {
  const defaults = personaControllerDefaults();
  const cycleN = clampSetting(
    elements.personaControllerCycle.value,
    1,
    200,
    defaults.cycleN,
  );
  const bestCount = clampSetting(
    elements.personaControllerBest.value,
    0,
    cycleN,
    Math.min(defaults.bestCount, cycleN),
  );
  const avoidCount = clampSetting(
    elements.personaControllerAvoid.value,
    0,
    cycleN,
    Math.min(defaults.avoidCount, cycleN),
  );
  return normalizeController({
    cycleN,
    bestCount,
    avoidCount,
    minStreakBest: clampSetting(
      elements.personaControllerMinStreak.value,
      0,
      cycleN,
      defaults.minStreakBest,
    ),
    maxStreakAvoid: clampSetting(
      elements.personaControllerMaxAvoid.value,
      1,
      cycleN,
      defaults.maxStreakAvoid,
    ),
    shuffle: elements.personaControllerShuffle.checked,
  });
}

function commitPersonaControllerChange() {
  const controller = readPersonaControllerFromControls();
  // 自由难度模式下，人格面板改的是"当前档位"的配置，不再是全局人格。
  const scoped = state.freeDifficulty
    ? updateDifficultyCustomization({ controller })
    : null;
  if (scoped) {
    renderDifficultySlots();
  } else {
    state.personaController = controller;
    savePersonaSettings();
  }
  state.personaHistory = [];
  state.personaDecision = null;
  renderPersonaControllerSettings();
  updatePersonaDisplay();
}

function commitPersonaTraitChange() {
  const traits = readPersonaTraitsFromControls();
  const scoped = state.freeDifficulty
    ? updateDifficultyCustomization({ traits })
    : null;
  if (scoped) {
    renderDifficultySlots();
  } else {
    state.personaTraits = traits;
    savePersonaSettings();
  }
  state.personaHistory = [];
  state.personaDecision = null;
  renderPersonaTraits();
  updatePersonaDisplay();
}

function loadPersonaSettings({ preservePersonaId = false } = {}) {
  let savedId = "";
  let savedIntent = "persona";
  let savedTraits = [];
  let savedController = null;
  try {
    savedId = localStorage.getItem("xiangqi.persona.id") || "";
    savedIntent = localStorage.getItem("xiangqi.persona.intent") || "persona";
    savedTraits = JSON.parse(
      localStorage.getItem("xiangqi.persona.traits") || "[]",
    );
    savedController = JSON.parse(
      localStorage.getItem("xiangqi.persona.controller") || "null",
    );
  } catch {
    savedId = "";
    savedIntent = "persona";
    savedTraits = [];
    savedController = null;
  }
  const persona = getPersona(
    preservePersonaId ? state.personaId : savedId || state.personaId,
  );
  state.personaId = persona.id;
  state.personaIntent = [
    "persona",
    "nonBest",
    "capture",
    "check",
    "evade",
    "preserveMaterial",
  ].includes(savedIntent)
    ? savedIntent
    : "persona";
  state.personaTraits = normalizePersonaTraits(savedTraits);
  state.personaController =
    savedController && typeof savedController === "object"
      ? normalizeController({
          ...persona.controller,
          ...savedController,
        })
      : null;
  elements.personaSelect.value = persona.id;
  elements.personaIntentSelect.value = state.personaIntent;
  renderPersonaTraits();
  renderPersonaControllerSettings();
  updatePersonaDisplay();
}

function savePersonaSettings() {
  try {
    localStorage.setItem("xiangqi.persona.id", state.personaId);
    localStorage.setItem("xiangqi.persona.intent", state.personaIntent);
    localStorage.setItem(
      "xiangqi.persona.traits",
      JSON.stringify(state.personaTraits),
    );
    localStorage.setItem(
      "xiangqi.persona.controller",
      JSON.stringify(state.personaController),
    );
  } catch {
    // The selected persona still applies to the current page.
  }
  saveAppSettings();
}

function clampSetting(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function clampNumberSetting(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function currentDifficultyCustomization() {
  if (!state.freeDifficulty) return null;
  if (!DIFFICULTY_SLOT_IDS.includes(state.personaId)) return null;
  return (
    state.difficultyCustom[state.personaId] ??
    defaultCustomization(state.personaId)
  );
}

function activePersonaTraits() {
  return currentDifficultyCustomization()?.traits ?? state.personaTraits;
}

function activePersonaController() {
  return (
    currentDifficultyCustomization()?.controller ?? state.personaController
  );
}

/**
 * 所有界面显示、提示、预判和正式走子都必须经过这个入口，避免自由难度
 * 模式只在设置面板生效、真正搜索时却仍使用内置人格参数。
 */
function effectivePersona() {
  const base = getPersona(state.personaId);
  const customization = currentDifficultyCustomization();
  if (!customization) {
    return resolvePersona(
      base,
      state.personaTraits,
      state.personaController,
    );
  }
  const overridden = applyPersonaOverrides(base, customization);
  return resolvePersona(
    overridden,
    customization.traits,
    customization.controller,
  );
}

function personaRequestOverrides() {
  return currentDifficultyCustomization();
}

/**
 * 自由难度模式：9 个档位各存一份自定义参数。
 *
 * 存储策略：只有用户真正改过的档位才写进 localStorage，没改过的档位等同于
 * 内置人格。这样"重置当前难度""全部恢复默认""升级后默认值变化"都能干净生效。
 */
function difficultySlotCustomization(personaId) {
  if (!DIFFICULTY_SLOT_IDS.includes(personaId)) return null;
  return state.difficultyCustom[personaId] ?? defaultCustomization(personaId);
}

function updateDifficultyCustomization(partial, { persist = true } = {}) {
  const personaId = state.personaId;
  if (!DIFFICULTY_SLOT_IDS.includes(personaId)) return null;
  const next = normalizeDifficultyCustomization(
    { ...difficultySlotCustomization(personaId), ...partial },
    personaId,
  );
  state.difficultyCustom[personaId] = next;
  if (persist) saveDifficultySettings();
  return next;
}

function loadDifficultySettings() {
  try {
    state.freeDifficulty =
      localStorage.getItem(FREE_MODE_STORAGE_KEY) === "true";
    state.difficultyCustom = normalizeCustomizationMap(
      JSON.parse(localStorage.getItem(CUSTOM_MAP_STORAGE_KEY) || "{}"),
    );
  } catch {
    state.freeDifficulty = false;
    state.difficultyCustom = {};
  }
  // 自由模式里"最大思考时间"跟着当前档位走，不污染普通模式的设置。
  if (state.freeDifficulty) {
    const customization = difficultySlotCustomization(state.personaId);
    if (customization) state.thinkTimeMs = customization.movetimeMs;
  }
  elements.freeDifficultyToggle.checked = state.freeDifficulty;
  renderDifficultySlots();
  renderDifficultyPanel();
}

function saveDifficultySettings() {
  try {
    localStorage.setItem(
      FREE_MODE_STORAGE_KEY,
      state.freeDifficulty ? "true" : "false",
    );
    localStorage.setItem(
      CUSTOM_MAP_STORAGE_KEY,
      JSON.stringify(state.difficultyCustom),
    );
  } catch {
    // 存储不可用时，当前页面里的配置依然生效。
  }
}

function renderDifficultySlots() {
  if (!elements.difficultySlotList) return;
  elements.difficultySlotList.innerHTML = "";
  for (const personaId of DIFFICULTY_SLOT_IDS) {
    const persona = getPersona(personaId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "difficulty-slot";
    button.dataset.difficultySlot = personaId;
    button.textContent = persona.name;
    button.title = persona.summary;
    button.disabled = !state.freeDifficulty;
    button.classList.toggle("active", personaId === state.personaId);
    if (hasCustomization(state.difficultyCustom, personaId)) {
      button.classList.add("customized");
    }
    elements.difficultySlotList.append(button);
  }
}

function renderDifficultyPanel() {
  if (!elements.freeDifficultyPanel) return;
  const usable =
    state.freeDifficulty && DIFFICULTY_SLOT_IDS.includes(state.personaId);
  elements.freeDifficultyPanel.hidden = !usable;
  elements.resetDifficultySlotBtn.disabled = !usable;
  elements.resetDifficultyAllBtn.disabled = !state.freeDifficulty;
  elements.freeDifficultyStatus.textContent = state.freeDifficulty
    ? "开启后，下面 9 个档位各自保存思考深度、候选着法数、随机温度与思考时间；" +
      "性格与最优解调节器也分别保存，互不影响。"
    : "关闭时使用内置难度参数；开启后下面 9 个档位各自保存思考深度、候选着法数、随机温度与思考时间，互不影响。";
  if (!usable) return;
  const customization = difficultySlotCustomization(state.personaId);
  if (!customization) return;
  elements.freeDepthInput.value = String(customization.depth);
  elements.freeTopKInput.value = String(customization.topK);
  elements.freeTemperatureInput.value = String(customization.temperature);
  elements.freeThinkInput.value = String(customization.movetimeMs);
  // 性格 / 最优解调节器面板在自由模式下显示的就是"当前档位"的配置。
  renderPersonaTraits();
  renderPersonaControllerSettings();
}

/** 自由模式开启时把"最大思考时间"切到当前档位的值；关闭时切回普通模式。 */
function applyDifficultyThinkTimeToState() {
  if (state.freeDifficulty) {
    const customization = difficultySlotCustomization(state.personaId);
    if (customization) {
      state.thinkTimeMs = clampThinkTime(
        customization.movetimeMs,
        state.thinkTimeMs,
      );
    }
  } else {
    state.thinkTimeMs = clampThinkTime(state.standardThinkTimeMs, 3000);
  }
}

function setFreeDifficultyEnabled(enabled) {
  const next = Boolean(enabled);
  if (next === state.freeDifficulty) {
    elements.freeDifficultyToggle.checked = next;
    renderDifficultySlots();
    renderDifficultyPanel();
    return;
  }
  if (next) {
    // 先记住普通模式的时间，自由模式里无论怎么调都不会覆盖它。
    state.standardThinkTimeMs = state.thinkTimeMs;
    state.freeDifficulty = true;
    // 全局最优解调节器由档位配置接管，避免两个来源互相覆盖。
    state.personaController = null;
  } else {
    state.freeDifficulty = false;
  }
  state.personaHistory = [];
  state.personaDecision = null;
  applyDifficultyThinkTimeToState();
  elements.freeDifficultyToggle.checked = next;
  saveDifficultySettings();
  syncThinkTimeControls({ force: true });
  renderDifficultySlots();
  renderDifficultyPanel();
  updatePersonaDisplay();
  saveAppSettings();
}

function selectDifficultySlot(personaId) {
  if (!DIFFICULTY_SLOT_IDS.includes(personaId)) return;
  state.personaId = personaId;
  elements.personaSelect.value = personaId;
  state.personaController = null;
  state.personaHistory = [];
  state.personaDecision = null;
  applyDifficultyThinkTimeToState();
  savePersonaSettings();
  syncThinkTimeControls({ force: true });
  renderDifficultySlots();
  renderDifficultyPanel();
  updatePersonaDisplay();
}

function commitDifficultyInputs() {
  if (
    !state.freeDifficulty ||
    !DIFFICULTY_SLOT_IDS.includes(state.personaId)
  ) {
    return;
  }
  const customization = updateDifficultyCustomization({
    depth: elements.freeDepthInput.value,
    topK: elements.freeTopKInput.value,
    temperature: elements.freeTemperatureInput.value,
    movetimeMs: elements.freeThinkInput.value,
  });
  if (!customization) return;
  state.thinkTimeMs = customization.movetimeMs;
  state.personaHistory = [];
  state.personaDecision = null;
  syncThinkTimeControls({ force: true });
  renderDifficultySlots();
  updatePersonaDisplay();
}

function resetDifficultySlot() {
  if (!DIFFICULTY_SLOT_IDS.includes(state.personaId)) return;
  const name = getPersona(state.personaId).name;
  delete state.difficultyCustom[state.personaId];
  state.personaHistory = [];
  state.personaDecision = null;
  applyDifficultyThinkTimeToState();
  saveDifficultySettings();
  syncThinkTimeControls({ force: true });
  renderDifficultySlots();
  renderDifficultyPanel();
  updatePersonaDisplay();
  showToast(`「${name}」已恢复为内置参数。`, "info");
}

function resetAllDifficulties() {
  state.difficultyCustom = {};
  state.personaHistory = [];
  state.personaDecision = null;
  applyDifficultyThinkTimeToState();
  saveDifficultySettings();
  syncThinkTimeControls({ force: true });
  renderDifficultySlots();
  renderDifficultyPanel();
  updatePersonaDisplay();
  showToast("9 个难度档位已全部恢复内置参数。", "info");
}

function loadAppSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || "{}");
  } catch {
    saved = {};
  }

  if (saved.humanSide === RED || saved.humanSide === BLACK) {
    state.humanSide = saved.humanSide;
    elements.humanSideSelect.value = saved.humanSide;
  }
  state.matchMode = saved.matchMode === "human" ? "human" : "ai";
  elements.matchModeSelect.value = state.matchMode;
  if (state.matchMode === "human") {
    elements.humanSideSelect.disabled = true;
  }
  state.thinkTimeMs = clampThinkTime(saved.thinkTimeMs, state.thinkTimeMs);
  // 普通模式与自由难度模式各记一份时间：自由模式里改了滑杆，
  // 关掉自由模式后仍要回到原来那档时间。
  state.standardThinkTimeMs = clampThinkTime(
    saved.standardThinkTimeMs,
    state.thinkTimeMs,
  );

  if (Number.isFinite(Number(saved.threads))) {
    elements.threadsInput.value = String(
      clampSetting(saved.threads, 1, 64, 14),
    );
    elements.threadsInput.dataset.userEdited = "true";
  }
  if (Number.isFinite(Number(saved.hash))) {
    elements.hashInput.value = String(
      clampSetting(saved.hash, 16, 65536, 1024),
    );
    elements.hashInput.dataset.userEdited = "true";
  }
  if (Number.isFinite(Number(saved.multiPV))) {
    elements.multiPvInput.value = String(
      clampSetting(saved.multiPV, 1, 16, 1),
    );
  }
  if (typeof saved.boardFlipped === "boolean") {
    state.boardFlipped = saved.boardFlipped;
  }
  state.engineThinkMode = normalizeEngineThinkMode(saved.engineThinkMode);
  state.lowPowerMode = saved.lowPowerMode === true;
  state.resourceBaseline =
    saved.resourceBaseline && typeof saved.resourceBaseline === "object"
      ? {
          threads: Number(saved.resourceBaseline.threads),
          hash: Number(saved.resourceBaseline.hash),
          multiPV: Number(saved.resourceBaseline.multiPV),
          engineThinkMode: normalizeEngineThinkMode(
            saved.resourceBaseline.engineThinkMode,
          ),
          continuousThinkingEnabled:
            saved.resourceBaseline.continuousThinkingEnabled === true,
        }
      : null;
}

function saveAppSettings() {
  try {
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({
        humanSide: state.humanSide,
        matchMode: state.matchMode,
        thinkTimeMs: state.thinkTimeMs,
        standardThinkTimeMs: state.standardThinkTimeMs,
        threads: Number(elements.threadsInput.value) || 14,
        hash: Number(elements.hashInput.value) || 1024,
        multiPV: Number(elements.multiPvInput.value) || 1,
        boardFlipped: state.boardFlipped,
        engineThinkMode: state.engineThinkMode,
        lowPowerMode: state.lowPowerMode,
        resourceBaseline: state.resourceBaseline,
        personaId: state.personaId,
        personaIntent: state.personaIntent,
      }),
    );
  } catch {
    // The settings still apply for the current page.
  }
}

function currentAiMoveNumber() {
  const aiSide = opposite(state.humanSide);
  let turn = state.turn;
  try {
    turn = parseFen(state.playStartFen).turn;
  } catch {
    turn = state.turn;
  }
  let completed = 0;
  for (const uci of state.moveHistory) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) break;
    if (turn === aiSide) completed += 1;
    turn = opposite(turn);
  }
  return completed + 1;
}

function personaPhaseLabel(phase) {
  if (phase === "opening") return "开局";
  if (phase === "middlegame") return "中盘";
  return "残局";
}

function updatePersonaDisplay() {
  // 自由难度模式下显示与下发给引擎的必须是同一份人格配置。
  const persona = effectivePersona();
  const moveNumber = currentAiMoveNumber();
  const phase = persona.mode === "engine_best"
    ? "opening"
    : getMovePhase(moveNumber);
  const phaseText = persona.mode === "engine_best"
    ? "始终最优"
    : `${personaPhaseLabel(phase)}第 ${moveNumber} 手`;
  // 界面显示的"本步思考多久"必须和真正下发给引擎的时间一致：
  // 超级大师按用户设置的完整时间走，其他人格仍是 min(用户设置, 人格建议)。
  const effectiveTime = resolvePersonaThinkMs({
    persona,
    requestedThinkMs: state.thinkTimeMs,
  });
  let timeText;
  if (supportsPonder(persona)) {
    timeText = `每步思考 ${formatThinkTime(effectiveTime)}`;
  } else if (effectiveTime < persona.movetimeMs) {
    timeText =
      `每步建议 ${formatThinkTime(persona.movetimeMs)}，` +
      `受当前上限限制为 ${formatThinkTime(effectiveTime)}`;
  } else {
    timeText = `每步建议 ${formatThinkTime(persona.movetimeMs)}`;
  }
  const forecastText =
    supportsPonder(persona) && state.continuousThinkingEnabled
      ? " · 预判续算已就绪"
      : "";
  elements.personaInfo.textContent =
    `${persona.name} · ${phaseText} · ${timeText}${forecastText}`;
  elements.personaInfo.title = persona.summary;
  elements.personaTraitSettings.hidden = persona.mode === "engine_best";
  elements.personaControllerSettings.hidden =
    persona.mode === "engine_best";
  if (state.personaIntent !== "persona") {
    elements.personaInfo.textContent += ` · ${
      elements.personaIntentSelect.selectedOptions[0]?.textContent ?? "指定倾向"
    }`;
  }

  if (!state.personaDecision) {
    const controller = getControllerDecision(
      persona,
      state.personaHistory.length,
      persona.signature,
    );
    elements.personaDecision.textContent = state.personaIntent !== "persona"
      ? "本步执行指定倾向，动态配额暂不参与"
      : persona.mode === "engine_best"
        ? "本步配额：始终走引擎最优"
        : `本步配额：${controller.isBestStep ? "走最优" : "避开首选"}`;
    return;
  }
  const decision = state.personaDecision;
  elements.personaDecision.textContent =
    `上一步：${decision.intentName && decision.intent !== "persona" ? `${decision.intentName} · ` : ""}${decision.categoryName || "已选着"} · 损失 ${(Math.max(0, decision.loss || 0) * 100).toFixed(1)}%${
      decision.intentApplied === false
        ? ` · ${decision.intentFallbackReason || "未找到符合项"}`
        : ""
    }${decision.controllerFallbackReason ? ` · ${decision.controllerFallbackReason}` : ""}`;
}

function loadHintSettings() {
  try {
    state.hintEnabled =
      localStorage.getItem("xiangqi.hint.enabled") === "true";
  } catch {
    state.hintEnabled = false;
  }
}

function saveHintSettings() {
  try {
    localStorage.setItem(
      "xiangqi.hint.enabled",
      state.hintEnabled ? "true" : "false",
    );
  } catch {
    // The toggle still works for the current page.
  }
}

function loadVisionSettings() {
  let saved = {};
  try {
    saved = JSON.parse(
      localStorage.getItem("xiangqi.vision.settings") || "{}",
    );
  } catch {
    saved = {};
  }
  const savedModel =
    typeof saved.model === "string" ? saved.model.trim() : "";
  elements.deepseekVisionModel.value =
    savedModel &&
    savedModel !== "deepseek-vl2" &&
    !/^deepseek-(?:chat|reasoner)$/i.test(savedModel)
      ? savedModel
      : "deepseek-flash";
  elements.visionRefine.checked = saved.refine !== false;
}

function saveVisionSettings() {
  try {
    localStorage.setItem(
      "xiangqi.vision.settings",
      JSON.stringify({
        model:
          elements.deepseekVisionModel.value.trim() || "deepseek-flash",
        refine: elements.visionRefine.checked,
      }),
    );
  } catch {
    // The model setting still works for the current page.
  }
}

function refreshVoiceOptions() {
  if (!("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    elements.voiceSelect.dataset.preferredVoice || elements.voiceSelect.value;
  elements.voiceSelect.innerHTML = '<option value="">系统默认</option>';
  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} · ${voice.lang}`;
    elements.voiceSelect.append(option);
  }
  const preferredExists = voices.some((voice) => voice.voiceURI === preferred);
  const chineseVoice = voices.find((voice) => /^zh/i.test(voice.lang));
  elements.voiceSelect.value =
    (preferredExists && preferred) || chineseVoice?.voiceURI || "";
}

function selectedSpeechVoice() {
  if (!("speechSynthesis" in window)) return null;
  return (
    window.speechSynthesis
      .getVoices()
      .find((candidate) => candidate.voiceURI === elements.voiceSelect.value) ??
    null
  );
}

function speechTaskOptions({
  channel = "manual",
  priority = VOICE_PRIORITY.TEST,
  auto = false,
  generation = commentaryGeneration,
  rate,
} = {}) {
  return {
    channel,
    priority,
    auto,
    generation,
    // 默认跟随本机语速设置；跨设备转发时可以显式指定语速。
    rate: Number.isFinite(Number(rate)) ? Number(rate) : state.speechRate,
    // 音色永远用本机选中的中文语音：转发过来的 voiceUri 在别的设备上不存在。
    voiceUri: elements.voiceSelect.value,
  };
}

function splitSpeechText(text, maxChars = SPEECH_CHUNK_MAX_CHARS) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const limit = Math.max(20, Number(maxChars) || SPEECH_CHUNK_MAX_CHARS);
  const sentences =
    normalized.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [normalized];
  const chunks = [];
  let current = "";

  const appendPart = (part) => {
    for (const character of Array.from(part)) {
      if (current && current.length >= limit) {
        chunks.push(current);
        current = "";
      }
      current += character;
    }
  };

  for (const sentence of sentences) {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) continue;
    if (current && current.length + cleanSentence.length > limit) {
      chunks.push(current);
      current = "";
    }
    if (cleanSentence.length > limit) appendPart(cleanSentence);
    else current += cleanSentence;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [normalized];
}

async function broadcastVoice(payload = {}) {
  if (!state.voiceShareEnabled) return;
  try {
    await fetch("/api/voice/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        origin: VOICE_CLIENT_ID,
        timestamp: Date.now(),
        ...payload,
      }),
    });
  } catch {
    // Voice sharing is best-effort; local playback must still work.
  }
}

function unlockSpeechSynthesis() {
  if (speechUnlocked || !("speechSynthesis" in window)) return;
  speechUnlocked = true;
  try {
    const utterance = new window.SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    utterance.rate = 2;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Some browsers unlock speech only after an actual user gesture.
  }
}

function playNextSpeech(nextItem = null) {
  if (activeSpeechItem || activeSpeechUtterance) return;
  if (!("speechSynthesis" in window)) {
    voiceQueue.clear();
    showToast("当前浏览器不支持语音朗读。", "error");
    return;
  }
  if (typeof window.SpeechSynthesisUtterance !== "function") {
    voiceQueue.clear();
    showToast("当前浏览器缺少语音朗读组件。", "error");
    return;
  }

  const item = nextItem || voiceQueue.takeNext();
  if (!item) return;
  const voice = window.speechSynthesis
    .getVoices()
    .find((candidate) => candidate.voiceURI === item.voiceUri);

  // 一段吐槽可能被切成多个短片（谷歌浏览器会在约 15 秒处截断超长语音）。
  // 这些短片必须作为一个整体播完，中途不允许更高优先级的任务插进来，
  // 否则一句话会被打断成"半句 + 别的话 + 剩下的半句"。
  const chunks =
    Array.isArray(item.chunks) && item.chunks.length
      ? item.chunks
      : splitSpeechText(item.text);
  const parts = chunks.length ? chunks : [item.text];
  let partIndex = 0;
  let finished = false;

  activeSpeechItem = item;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(speechWatchdogTimer);
    speechWatchdogTimer = null;
    activeSpeechUtterance = null;
    if (activeSpeechCancel === finish) activeSpeechCancel = null;
    if (activeSpeechItem?.id === item.id) activeSpeechItem = null;
    const queuedNext = voiceQueue.finish(item.id);
    queueMicrotask(() => playNextSpeech(queuedNext));
  };

  const armWatchdog = (text) => {
    clearTimeout(speechWatchdogTimer);
    const watchdogMs = Math.max(
      5000,
      Math.min(
        30000,
        Math.max(1, Number(item.rate) || 1.5) * text.length * 160 + 4500,
      ),
    );
    speechWatchdogTimer = setTimeout(finish, watchdogMs);
  };

  const playPart = () => {
    if (finished) return;
    if (partIndex >= parts.length) {
      finish();
      return;
    }
    const partText = parts[partIndex];
    partIndex += 1;
    const utterance = new window.SpeechSynthesisUtterance(partText);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || "zh-CN";
    utterance.rate = clampNumberSetting(item.rate, 0.5, 3, state.speechRate);
    utterance.pitch = 1;
    utterance.onend = () => {
      if (activeSpeechUtterance === utterance) activeSpeechUtterance = null;
      queueMicrotask(playPart);
    };
    utterance.onerror = finish;
    activeSpeechUtterance = utterance;
    armWatchdog(partText);
    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
    }
  };

  activeSpeechCancel = finish;
  playPart();
}

function speakCommentary(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) return null;
  const { skipBroadcast = false, ...speechOptions } = options;
  if (state.voiceShareEnabled && !skipBroadcast) {
    void broadcastVoice({
      action: "speak",
      text: message,
      channel: speechOptions.channel || "manual",
      priority: speechOptions.priority,
      rate: speechOptions.rate ?? state.speechRate,
    });
  }

  // 整段文本只占一个队列任务，播放时再切片。
  // 这样中间不会有更高优先级的语音插进来，保证"一句话说完再说下一句"。
  const chunks = splitSpeechText(message);
  const item = voiceQueue.enqueue({
    text: message,
    chunks,
    ...speechTaskOptions(speechOptions),
  });
  playNextSpeech();
  return item;
}

function enqueueCommentarySpeech(text, task) {
  if (!state.quipVoiceEnabled) return null;
  return speakCommentary(text, {
    channel: "quip",
    priority:
      task.kind === "move"
        ? VOICE_PRIORITY.MOVE_QUIP
        : VOICE_PRIORITY.POSITION_QUIP,
    auto: true,
    generation: task.generation,
  });
}

function clearPositionCommentarySchedule({ abortRequest = true } = {}) {
  clearTimeout(analysisCommentaryTimer);
  analysisCommentaryTimer = null;
  commentaryQueue = commentaryQueue.filter((task) => task.kind === "move");
  if (abortRequest && commentaryCurrentTask?.kind === "position") {
    commentaryController?.abort();
    commentaryController = null;
    commentaryCurrentTask = null;
  }
}

function advanceCommentaryPosition() {
  commentaryGeneration += 1;
  voiceQueue.invalidateGeneration(commentaryGeneration);
  clearPositionCommentarySchedule();
  commentaryQueue = [];
  commentaryController?.abort();
  commentaryController = null;
  commentaryCurrentTask = null;
  clearInterval(coachTypeTimer);
  coachTypeTimer = null;
  lastCommentaryDeliveredAt = 0;
  return commentaryGeneration;
}

function stopCommentaryPlayback({ broadcast = true } = {}) {
  commentaryGeneration += 1;
  clearTimeout(analysisCommentaryTimer);
  analysisCommentaryTimer = null;
  commentaryQueue = [];
  commentaryController?.abort();
  commentaryController = null;
  commentaryCurrentTask = null;
  voiceQueue.clear();
  // 先收口正在播放的那一段（可能是长语音的中间一片），再取消浏览器的朗读。
  const cancelActive = activeSpeechCancel;
  activeSpeechCancel = null;
  clearTimeout(speechWatchdogTimer);
  speechWatchdogTimer = null;
  activeSpeechItem = null;
  activeSpeechUtterance = null;
  if (cancelActive) cancelActive();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (broadcast) void broadcastVoice({ action: "stop", channel: "all" });
}

function buildCommentaryContext(move, source, description, movingSide) {
  return {
    lastMove: {
      side: movingSide === RED ? "red" : "black",
      notation: moveToUci(move),
      description,
    },
    fen: boardToFen(state.board, state.turn),
    turn: state.turn === RED ? "red" : "black",
    moveCount: state.moveHistory.length,
    gameState: state.status.reason || "playing",
    engineScore: elements.scoreValue.textContent,
    engineDepth: elements.depthValue.textContent,
    principalVariation: elements.pvText.textContent,
    source,
  };
}

function buildPositionCommentaryContext() {
  return {
    lastMove: null,
    fen: boardToFen(state.board, state.turn),
    turn: state.turn === RED ? "red" : "black",
    moveCount: state.moveHistory.length,
    gameState: state.status.reason || "playing",
    engineScore: elements.scoreValue.textContent,
    engineDepth: elements.depthValue.textContent,
    principalVariation: elements.pvText.textContent,
    source: "position",
  };
}

function commentaryCanRun() {
  return (
    state.quipEnabled && Boolean(elements.deepseekApiKey.value.trim())
  );
}

function hasPendingPositionCommentary(generation) {
  return (
    (commentaryCurrentTask?.kind === "position" &&
      commentaryCurrentTask.generation === generation) ||
    commentaryQueue.some(
      (task) => task.kind === "position" && task.generation === generation,
    )
  );
}

function hasPendingMoveCommentary() {
  return (
    commentaryCurrentTask?.kind === "move" ||
    commentaryQueue.some((task) => task.kind === "move")
  );
}

function queueCommentaryTask(context, kind, generation = commentaryGeneration) {
  if (!commentaryCanRun() || generation !== commentaryGeneration) return;
  if (
    kind === "position" &&
    (hasPendingMoveCommentary() || hasPendingPositionCommentary(generation))
  ) {
    return;
  }
  commentaryQueue.push({ context, kind, generation });
  if (commentaryQueue.length > 6) commentaryQueue = commentaryQueue.slice(-6);
  void processCommentaryQueue();
}

function positionCommentaryAllowed() {
  if (!commentaryCanRun() || !analysisAllowed()) return false;
  // 低功耗模式不再常驻 go infinite，但吐槽仍应继续：
  // 用最近一次有限搜索留下的评分/变化继续点评，不再依赖 analysisActive。
  if (state.lowPowerMode) return state.engineReady;
  return state.analysisActive;
}

function schedulePositionCommentary(delayMs) {
  if (!positionCommentaryAllowed() || analysisCommentaryTimer) return;
  if (
    hasPendingMoveCommentary() ||
    hasPendingPositionCommentary(commentaryGeneration)
  ) {
    return;
  }

  const elapsed = Date.now() - lastCommentaryDeliveredAt;
  const waitMs =
    delayMs ??
    (lastCommentaryDeliveredAt
      ? Math.max(2000, COMMENTARY_REPEAT_DELAY_MS - elapsed)
      : COMMENTARY_INITIAL_DELAY_MS);
  analysisCommentaryTimer = setTimeout(() => {
    analysisCommentaryTimer = null;
    if (!positionCommentaryAllowed()) return;
    if (
      hasPendingMoveCommentary() ||
      hasPendingPositionCommentary(commentaryGeneration)
    ) {
      return;
    }
    queueCommentaryTask(
      buildPositionCommentaryContext(),
      "position",
      commentaryGeneration,
    );
  }, Math.max(0, waitMs));
}

async function processCommentaryQueue() {
  if (commentaryRunning) return;
  commentaryRunning = true;
  try {
    while (commentaryQueue.length && commentaryCanRun()) {
      const task = commentaryQueue.shift();
      if (task.generation !== commentaryGeneration) continue;
      const controller = new AbortController();
      commentaryController = controller;
      commentaryCurrentTask = task;
      let delivered = false;
      try {
        const response = await fetch("/api/commentary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: elements.deepseekApiKey.value.trim(),
            model: elements.deepseekModel.value.trim() || "deepseek-flash",
            context: task.context,
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || `DeepSeek 请求失败（${response.status}）。`);
        }
        const text = String(payload.text || "").trim();
        if (!text) continue;
        if (
          task.generation !== commentaryGeneration ||
          !commentaryCanRun()
        ) {
          continue;
        }
        elements.commentaryText.textContent = text;
        state.lastCommentaryText = text;
        enqueueCommentarySpeech(text, task);
        lastCommentaryDeliveredAt = Date.now();
        delivered = true;
      } catch (error) {
        if (error?.name !== "AbortError") {
          commentaryQueue = [];
          showToast(
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      } finally {
        if (commentaryController === controller) {
          commentaryController = null;
          commentaryCurrentTask = null;
        }
      }
      if (delivered) {
        queueMicrotask(() => schedulePositionCommentary());
      }
    }
  } finally {
    commentaryRunning = false;
    if (commentaryQueue.length && commentaryCanRun()) {
      queueMicrotask(() => void processCommentaryQueue());
    }
  }
}

function setEngineState(status, detail = "") {
  const labels = {
    starting: "正在准备",
    ready: "棋力引擎已就绪",
    thinking: "正在思考",
    analyzing: "持续分析",
    stopped: "已停止",
    error: "引擎异常",
  };
  const classes = {
    starting: "status-waiting",
    ready: "status-ready",
    thinking: "status-thinking",
    analyzing: "status-thinking",
    stopped: "status-waiting",
    error: "status-error",
  };
  const text = labels[status] ?? "正在准备";
  elements.engineBadge.className = `status-badge ${classes[status] ?? "status-waiting"}`;
  elements.engineBadge.lastChild.textContent = ` ${text}`;
  elements.engineStateText.textContent = detail || text;
  if (status === "ready" || status === "thinking" || status === "analyzing") {
    elements.engineStateText.textContent =
      status === "thinking"
        ? detail || "正在计算"
        : status === "analyzing"
          ? detail || "持续分析中"
          : detail || "在线";
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatScore(score) {
  if (!score) return "--";
  const side = state.turn;
  const redSign = side === RED ? 1 : -1;
  if (score.type === "mate") {
    const mateValue = score.value * redSign;
    return mateValue > 0 ? `绝杀 ${Math.abs(score.value)}` : `被绝杀 ${Math.abs(score.value)}`;
  }
  const redCentipawns = score.value * redSign;
  const pawns = redCentipawns / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function formatThinkTime(milliseconds) {
  if (milliseconds < 1000) return `${milliseconds} 毫秒`;
  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
}

function setThinkTime(milliseconds) {
  const value = clampThinkTime(milliseconds, state.thinkTimeMs);
  state.thinkTimeMs = value;
  if (state.freeDifficulty) {
    // 自由难度模式：最大思考时间属于"当前档位"的配置，不能写进全局设置。
    updateDifficultyCustomization({ movetimeMs: value });
    renderDifficultySlots();
  } else {
    state.standardThinkTimeMs = value;
  }
  syncThinkTimeControls();
  updatePersonaDisplay();
  saveAppSettings();
}

/**
 * 把 state.thinkTimeMs 回写到"毫秒输入框 + 对数滑杆 + 预设按钮"。
 *
 * 滑杆是 0~1000 的对数刻度（见 src/difficulty.js 的 thinkMsToSlider）：
 * 1ms 和 30 分钟都能拖到，中段留给常用的 1 秒 ~ 1 分钟。
 * 正在输入/拖拽的控件不回写，否则光标会跳、拖拽会卡。
 */
function syncThinkTimeControls({ force = false } = {}) {
  const value = clampThinkTime(state.thinkTimeMs, 3000);
  elements.thinkTimeValue.textContent = formatThinkTime(value);
  if (force || document.activeElement !== elements.thinkTimeInput) {
    elements.thinkTimeInput.value = String(value);
  }
  if (force || document.activeElement !== elements.thinkTimeRange) {
    elements.thinkTimeRange.value = String(thinkMsToSlider(value));
  }
  for (const button of document.querySelectorAll("[data-think-time]")) {
    button.classList.toggle(
      "active",
      Number(button.dataset.thinkTime) === value,
    );
  }
}

function hintCanDisplay() {
  if (
    !state.hintEnabled ||
    state.mode !== "play" ||
    state.status.state !== "playing"
  ) {
    return false;
  }
  // 自由行棋与双人同机没有"我方"，轮到谁就给谁提示。
  if (state.freePlay || state.matchMode === "human") return true;
  return state.gameStarted && state.turn === state.humanSide;
}

function refreshHintDisplay() {
  const visible = hintCanDisplay();
  elements.hintBanner.hidden = !visible;
  elements.hintMoveText.textContent = state.hintNotation || "正在分析";
  elements.hintToggleBtn.classList.toggle("active", state.hintEnabled);
  elements.hintToggleBtn.setAttribute(
    "aria-pressed",
    String(state.hintEnabled),
  );
  elements.hintToggleLabel.textContent = state.hintEnabled
    ? "关闭提示"
    : "提示最优解";
  elements.hintToggleBtn.title = state.hintEnabled
    ? "提示已开启：只在棋盘上标示建议着法"
    : "开启后只在棋盘上标示引擎建议着法";
}

function setHintMove(move) {
  const previousUci = state.hintMove ? moveToUci(state.hintMove) : "";
  const nextUci = move ? moveToUci(move) : "";
  if (previousUci === nextUci) return;

  state.hintMove = move;
  state.hintNotation = "";
  if (move) {
    try {
      state.hintNotation = formatMoveNotation(state.board, move);
    } catch {
      state.hintMove = null;
    }
  }
  refreshHintDisplay();
  renderBoard();
}

async function setHintEnabled(enabled, { resume = true } = {}) {
  state.hintEnabled = Boolean(enabled);
  saveHintSettings();
  if (!state.hintEnabled) {
    cancelHintOnce();
    setHintMove(null);
  }
  refreshHintDisplay();
  renderBoard();
  if (!state.hintEnabled || !resume) return;
  // 低功耗下不做常驻分析，只跑一次有限搜索拿推荐着法。
  if (!persistentAnalysisAllowed()) {
    scheduleHintOnce(0);
    return;
  }
  if (analysisAllowed() && !state.analysisActive && !state.analysisStarting) {
    await startContinuousAnalysis({ restart: true });
  }
}

function refreshGameStatus() {
  state.status = gameStatus(state.board, state.turn);
  const sideText = state.turn === RED ? "红方" : "黑方";
  elements.turnTitle.textContent =
    state.status.state !== "playing"
      ? "本局结束"
      : state.mode === "edit"
        ? "编辑局面"
        : state.gameStarted
          ? `${sideText}行棋`
          : "等待开始";
  elements.sideValue.textContent = sideText;
  elements.humanSideValue.textContent = state.humanSide === RED ? "红方" : "黑方";
  elements.positionStateValue.textContent = state.status.reason || "正常";
  elements.gameStateChip.className = "state-chip";

  if (state.status.state === "playing") {
    if (state.mode === "edit") {
      elements.gameStateChip.textContent = "编辑中";
    } else if (!state.gameStarted) {
      elements.gameStateChip.textContent = "等待开始";
    } else if (state.status.reason === "将军") {
      elements.gameStateChip.textContent = "将军";
      elements.gameStateChip.classList.add("check");
    } else {
      elements.gameStateChip.textContent = "对局进行中";
    }
  } else {
    const winner = state.status.state === "red_win" ? "红方胜" : "黑方胜";
    elements.gameStateChip.textContent = `${winner} · ${state.status.reason}`;
    elements.gameStateChip.classList.add("win");
  }

  elements.pieceCountText.textContent = String(countPieces(state.board));
  elements.moveCountText.textContent = String(state.moveHistory.length);
  elements.lastMoveText.textContent = state.lastMoveText;
  elements.saveRecordBtn.disabled =
    state.reviewRunning || state.moveHistory.length === 0;
  elements.fenInput.value = boardToFen(state.board, state.turn);
  refreshHintDisplay();
  updateAnalysisControls();
}

function createGuidesSvg() {
  const lines = [];
  const addLine = (x1, y1, x2, y2, width = 3) => {
    lines.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${width}" />`,
    );
  };
  for (let row = 0; row < 10; row += 1) addLine(50, 50 + row * 100, 850, 50 + row * 100);
  for (let col = 0; col < 9; col += 1) {
    const x = 50 + col * 100;
    if (col === 0 || col === 8) {
      addLine(x, 50, x, 950);
    } else {
      addLine(x, 50, x, 450);
      addLine(x, 550, x, 950);
    }
  }

  addLine(350, 50, 550, 250);
  addLine(550, 50, 350, 250);
  addLine(350, 750, 550, 950);
  addLine(550, 750, 350, 950);

  const marks = [
    [150, 250],
    [750, 250],
    [150, 750],
    [750, 750],
    [350, 350],
    [550, 350],
    [350, 650],
    [550, 650],
  ];
  for (const [x, y] of marks) {
    const gap = 6;
    const length = 12;
    lines.push(
      `<path d="M${x - gap - length} ${y - gap} h${length} M${x - gap} ${y - gap - length} v${length}" />`,
      `<path d="M${x + gap} ${y - gap} h${length} M${x + gap} ${y - gap - length} v${length}" />`,
      `<path d="M${x - gap - length} ${y + gap} h${length} M${x - gap} ${y + gap} v${length}" />`,
      `<path d="M${x + gap} ${y + gap} h${length} M${x + gap} ${y + gap} v${length}" />`,
    );
  }

  return `
    <svg viewBox="0 0 900 1000" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" stroke="#765127" stroke-linecap="square">
        ${lines.join("")}
      </g>
      <g fill="#73502a" font-family="KaiTi, STKaiti, serif" font-size="50" text-anchor="middle">
        <text x="225" y="520">楚 河</text>
        <text x="675" y="520">漢 界</text>
      </g>
    </svg>
  `;
}

function renderHintOverlay() {
  if (!hintCanDisplay() || !state.hintMove) return;
  const from = boardPointToDisplay(state.hintMove.from, state.boardFlipped);
  const to = boardPointToDisplay(state.hintMove.to, state.boardFlipped);
  const fromX = 50 + from[1] * 100;
  const fromY = 50 + from[0] * 100;
  const toX = 50 + to[1] * 100;
  const toY = 50 + to[0] * 100;
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const shorten = Math.min(58, distance * 0.24);
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const lineStartX = fromX + unitX * shorten;
  const lineStartY = fromY + unitY * shorten;
  const lineEndX = toX - unitX * shorten;
  const lineEndY = toY - unitY * shorten;

  elements.boardPieces.insertAdjacentHTML(
    "afterbegin",
    `<svg class="hint-layer" viewBox="0 0 900 1000" aria-hidden="true">
      <defs>
        <marker id="hint-arrowhead" markerWidth="28" markerHeight="28" refX="24" refY="14" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0 0 L28 14 L0 28 Z" fill="#b87908" />
        </marker>
      </defs>
      <circle class="hint-origin" cx="${fromX}" cy="${fromY}" r="55" />
      <circle class="hint-target" cx="${toX}" cy="${toY}" r="59" />
      <line class="hint-arrow" x1="${lineStartX}" y1="${lineStartY}" x2="${lineEndX}" y2="${lineEndY}" marker-end="url(#hint-arrowhead)" />
    </svg>`,
  );
}

function reviewArrowMarkup() {
  if (state.mode !== "review" || !state.reviewArrows.length) return "";
  const defs = [];
  const shapes = [];
  state.reviewArrows.forEach((arrow, index) => {
    let move;
    try {
      move = uciToMove(arrow.uci);
    } catch {
      return;
    }
    const from = boardPointToDisplay(move.from, state.boardFlipped);
    const to = boardPointToDisplay(move.to, state.boardFlipped);
    let fromX = 50 + from[1] * 100;
    let fromY = 50 + from[0] * 100;
    let toX = 50 + to[1] * 100;
    let toY = 50 + to[0] * 100;
    if (arrow.duplicate) {
      const rawDeltaX = toX - fromX;
      const rawDeltaY = toY - fromY;
      const rawDistance = Math.hypot(rawDeltaX, rawDeltaY) || 1;
      const offsetX = (-rawDeltaY / rawDistance) * 24;
      const offsetY = (rawDeltaX / rawDistance) * 24;
      fromX += offsetX;
      fromY += offsetY;
      toX += offsetX;
      toY += offsetY;
    }
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const shorten = Math.min(60, distance * 0.26);
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const markerId = `review-arrowhead-${index}`;
    defs.push(
      `<marker id="${markerId}" markerWidth="28" markerHeight="28" refX="24" refY="14" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L28 14 L0 28 Z" fill="${arrow.color}" /></marker>`,
    );
    shapes.push(
      `<line class="review-arrow${arrow.dashed ? " dashed" : ""}" x1="${fromX + unitX * shorten}" y1="${fromY + unitY * shorten}" x2="${toX - unitX * shorten}" y2="${toY - unitY * shorten}" stroke="${arrow.color}" marker-end="url(#${markerId})" />`,
    );
  });
  if (!shapes.length) return "";
  return `<svg class="review-arrow-layer" viewBox="0 0 900 1000" aria-hidden="true"><defs>${defs.join("")}</defs>${shapes.join("")}</svg>`;
}

function renderBoard() {
  elements.boardPieces.innerHTML = "";
  renderHintOverlay();

  if (state.lastMove) {
    for (const point of [state.lastMove.from, state.lastMove.to]) {
      const display = boardPointToDisplay(point, state.boardFlipped);
      const ring = document.createElement("span");
      ring.className = "last-move-ring";
      ring.style.setProperty("--r", display[0]);
      ring.style.setProperty("--c", display[1]);
      elements.boardPieces.append(ring);
    }
  }

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = state.board[row][col];
      if (piece === ".") continue;
      const display = boardPointToDisplay([row, col], state.boardFlipped);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `board-piece ${pieceSide(piece) === RED ? "red-piece" : "black-piece"}`;
      button.textContent = pieceName(piece);
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      button.setAttribute("aria-label", `${pieceName(piece)} ${row},${col}`);
      button.style.setProperty("--r", display[0]);
      button.style.setProperty("--c", display[1]);
      if (
        state.selected &&
        state.selected[0] === row &&
        state.selected[1] === col
      ) {
        button.classList.add("selected");
      }
      elements.boardPieces.append(button);
    }
  }

  for (const move of state.legalMoves) {
    const display = boardPointToDisplay(move.to, state.boardFlipped);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `move-marker${
      state.board[move.to[0]][move.to[1]] === "." ? "" : " capture"
    }`;
    marker.dataset.row = String(move.to[0]);
    marker.dataset.col = String(move.to[1]);
    marker.setAttribute("aria-label", "可走位置");
    marker.style.setProperty("--r", display[0]);
    marker.style.setProperty("--c", display[1]);
    elements.boardPieces.append(marker);
  }

  const arrows = reviewArrowMarkup();
  if (arrows) elements.boardPieces.insertAdjacentHTML("beforeend", arrows);
}

function renderAll() {
  updatePersonaDisplay();
  refreshGameStatus();
  renderBoard();
  updateCoachUi();
  updateCommentaryUi();
}

function nearestPoint(event) {
  const rect = elements.board.getBoundingClientRect();
  const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
  const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
  const col = Math.round((xPercent - 5) / 11.25);
  const row = Math.round((yPercent - 5) / 10);
  if (row < 0 || row > 9 || col < 0 || col > 8) return null;
  return displayPointToBoard([row, col], state.boardFlipped);
}

function setBoardFlipped(flipped) {
  state.boardFlipped = Boolean(flipped);
  elements.flipBoardBtn.classList.toggle("active", state.boardFlipped);
  elements.flipBoardBtn.setAttribute("aria-pressed", String(state.boardFlipped));
  elements.flipBoardBtn.title = state.boardFlipped
    ? "当前为黑方视角，点击恢复红方视角"
    : "当前为红方视角，点击切换黑方视角";
  renderBoard();
  saveAppSettings();
}

/**
 * 当前局面是否接受人在棋盘上直接落子。
 *
 * 自由行棋：随时都能动子，且不需要先“开始对局”。
 * 双人同机：双方轮流操作，同样不需要引擎介入。
 * 人机对弈：只在我方行棋时接受点击。
 */
function boardAcceptsInput() {
  if (state.mode !== "play" || state.engineThinking) return false;
  // 自由行棋是摆棋/探索模式，即使当前局面已经绝杀也允许继续走子。
  if (state.freePlay) return true;
  // 正式对弈在绝杀、困毙等终局后锁定棋盘，避免选中棋子却无法落子的空操作。
  if (state.status.state !== "playing") return false;
  if (state.matchMode === "human") return true;
  return state.gameStarted && state.turn === state.humanSide;
}

function isHumanTurn() {
  return boardAcceptsInput();
}

/**
 * 自由行棋允许选中任意一方的棋子；其它模式只允许选中当前行棋方。
 */
function pieceMovableByUi(pieceSideValue) {
  if (state.freePlay) return true;
  return pieceSideValue === state.turn;
}

function selectPiece(row, col) {
  const piece = state.board[row][col];
  if (
    !boardAcceptsInput() ||
    piece === "." ||
    !pieceMovableByUi(pieceSide(piece))
  ) {
    state.selected = null;
    state.legalMoves = [];
    renderBoard();
    return;
  }
  state.selected = [row, col];
  // 走法按棋子自身的颜色生成，这样自由行棋里点谁就能走谁。
  state.legalMoves = generateLegalMoves(state.board, pieceSide(piece)).filter(
    (move) => move.from[0] === row && move.from[1] === col,
  );
  renderBoard();
}

function saveHistory() {
  state.history.push({
    board: cloneBoard(state.board),
    turn: state.turn,
    playStartFen: state.playStartFen,
    freePlayStartFen: state.freePlayStartFen,
    moveHistory: state.moveHistory.slice(),
    freeMoves: state.freeMoves.map((entry) => ({ ...entry })),
    moveEvaluations: state.moveEvaluations.slice(),
    personaHistory: state.personaHistory.slice(),
    personaDecision: state.personaDecision ? { ...state.personaDecision } : null,
    lastMove: state.lastMove ? { from: [...state.lastMove.from], to: [...state.lastMove.to] } : null,
    lastMoveText: state.lastMoveText,
  });
}

async function commitMove(move, source = "human") {
  // 终局后正式对弈不再接受落子；自由行棋仍可继续改变局面。
  if (state.status.state !== "playing" && !state.freePlay) return;
  const movingSide = pieceSide(state.board[move.from[0]][move.from[1]]);
  if (!movingSide) return;
  const description = formatMoveNotation(state.board, move);
  const fenBefore = boardToFen(state.board, movingSide);
  const commentaryPosition = advanceCommentaryPosition();
  // 旧的提示箭头属于上一局面，随落子一起作废。
  cancelHintOnce();
  setHintMove(null);
  saveHistory();
  state.board = applyMove(state.board, move);
  const uci = moveToUci(move);
  // 自由行棋里行棋方完全由 UI 决定，落子后不自动交换；其它模式照常轮转。
  if (!state.freePlay) state.turn = opposite(state.turn);
  const fenAfter = boardToFen(state.board, opposite(movingSide));
  state.moveHistory.push(uci);
  if (state.freePlay) {
    state.freeMoves.push({
      side: movingSide,
      uci,
      notation: description,
      fenBefore,
      fenAfter,
    });
  }
  state.lastMove = move;
  state.lastMoveSide = movingSide;
  state.lastMoveNotation = description;
  state.lastMoveText = `${
    source === "engine" ? "引擎" : source === "human" ? "我方" : "棋谱"
  } · ${description}`;
  state.selected = null;
  state.legalMoves = [];
  refreshGameStatus();
  renderBoard();
  queueCommentaryTask(
    buildCommentaryContext(move, source, description, movingSide),
    "move",
    commentaryPosition,
  );

  // 预判续算：玩家走的正是引擎预判的那一步，就直接 ponderhit 继承搜索树。
  // 必须赶在 evaluateLastMove / requestEngineMove 之前处理：它们会 stop 掉引擎，
  // 把已经算了很久的预判连同搜索树、深度、哈希一起丢掉。
  let inheritedMove = null;
  if (state.pondering && source === "human") {
    const canInherit =
      state.status.state === "playing" &&
      supportsPonder(effectivePersona());
    const decision = canInherit
      ? ponderHitDecision({
          ponderActive: true,
          ponderMove: state.ponderMove,
          playedUci: uci,
          source,
        })
      : "miss";
    if (decision === "hit") {
      inheritedMove = await resolveForecastHit();
    } else {
      await stopForecast({ silent: true });
    }
  }

  if (state.status.state !== "playing") {
    await haltEngineSearch({ detail: "对局已结束" });
    return;
  }

  await evaluateLastMove({
    fenBefore,
    fenAfter,
    move,
    description,
    movingSide,
    source,
  });
  updateCoachUi();
  if (state.coachMode && state.coachTrigger === "every-move") {
    void runCoachAnalysis({
      scope: "last",
      auto: true,
      generation: commentaryPosition,
    });
  }

  if (state.freePlay) {
    if (shouldKeepAnalyzing()) scheduleContinuousAnalysis(0);
    else if (state.hintEnabled) scheduleHintOnce(0);
    return;
  }
  if (state.matchMode === "human") {
    // 双人同机：引擎只负责分析，绝不代替任何一方落子。
    if (shouldKeepAnalyzing()) scheduleContinuousAnalysis(0);
    else if (state.hintEnabled) scheduleHintOnce(0);
    return;
  }
  if (state.gameStarted) {
    if (state.turn !== state.humanSide) {
      // 预判命中：这一步引擎早就想好了，直接落子。
      if (inheritedMove) await commitMove(inheritedMove, "engine");
      else await requestEngineMove();
    } else if (shouldKeepAnalyzing()) {
      await startContinuousAnalysis({ restart: true });
    } else if (state.hintEnabled) {
      // 不常驻分析（低功耗/分心）时，提示改为一次性有限搜索。
      scheduleHintOnce(0);
    }
  }
}

function handleBoardClick(event) {
  const point = nearestPoint(event);
  if (!point) return;
  const [row, col] = point;

  if (state.trainingActive) {
    handleTrainingClick(row, col);
    return;
  }

  if (state.mode === "review") return;

  if (state.mode === "edit") {
    state.board = cloneBoard(state.board);
    state.board[row][col] = state.editPiece;
    resetCurrentPosition();
    renderAll();
    return;
  }

  if (!boardAcceptsInput()) return;
  const clickedPiece = state.board[row][col];
  if (state.selected) {
    const move = state.legalMoves.find(
      (candidate) => candidate.to[0] === row && candidate.to[1] === col,
    );
    if (move) {
      void commitMove(move, "human");
      return;
    }
    if (
      clickedPiece !== "." &&
      pieceMovableByUi(pieceSide(clickedPiece))
    ) {
      selectPiece(row, col);
      return;
    }
    state.selected = null;
    state.legalMoves = [];
    renderBoard();
    return;
  }

  if (
    clickedPiece !== "." &&
    pieceMovableByUi(pieceSide(clickedPiece))
  ) {
    selectPiece(row, col);
  }
}

/**
 * 设置抽屉：引擎参数、AI 人格、DeepSeek 密钥都收在这里，默认隐藏。
 */
function setSettingsOpen(open) {
  state.settingsOpen = Boolean(open);
  document.body.classList.toggle("settings-open", state.settingsOpen);
  elements.settingsToggleBtn.setAttribute(
    "aria-expanded",
    String(state.settingsOpen),
  );
  elements.settingsToggleBtn.classList.toggle("active", state.settingsOpen);
  elements.settingsToggleLabel.textContent = state.settingsOpen
    ? "收起设置"
    : "设置";
}

function applyFullscreenUi() {
  state.globalFullscreen = Boolean(document.fullscreenElement);
  document.body.classList.toggle("focus-view", state.focusView);
  document.body.classList.toggle(
    "global-fullscreen",
    state.globalFullscreen,
  );
  elements.focusViewBtn.classList.toggle("active", state.focusView);
  elements.focusViewBtn.setAttribute(
    "aria-pressed",
    String(state.focusView),
  );
  elements.focusViewLabel.textContent = state.focusView
    ? "退出专注"
    : "专注视图";
  elements.globalFullscreenBtn.classList.toggle(
    "active",
    state.globalFullscreen,
  );
  elements.globalFullscreenBtn.setAttribute(
    "aria-pressed",
    String(state.globalFullscreen),
  );
  elements.globalFullscreenLabel.textContent = state.globalFullscreen
    ? "退出全屏"
    : "全局全屏";
}

function toggleFocusView(force = null) {
  state.focusView =
    typeof force === "boolean" ? force : !state.focusView;
  if (state.focusView) setSettingsOpen(false);
  applyFullscreenUi();
}

async function toggleGlobalFullscreen() {
  const fullscreenElement = document.fullscreenElement || null;
  if (fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
    return;
  }
  if (typeof document.documentElement.requestFullscreen !== "function") {
    showToast("当前浏览器不支持全局全屏。", "error");
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : String(error),
      "error",
    );
  }
}

function resetAllSettings() {
  const apiKeyStorageKey = "xiangqi.deepseek.apiKey";
  const typedApiKey = elements.deepseekApiKey.value.trim();
  try {
    if (typedApiKey) {
      localStorage.setItem(apiKeyStorageKey, typedApiKey);
    }
    for (const storage of [localStorage, sessionStorage]) {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith("xiangqi.") && key !== apiKeyStorageKey) {
          keys.push(key);
        }
      }
      for (const key of keys) storage.removeItem(key);
    }
  } catch {
    showToast("浏览器拒绝清理本地设置，请检查隐私设置。", "error");
    return;
  }
  showToast("除 API 密钥外的设置已恢复默认，正在刷新页面。");
  window.setTimeout(() => window.location.reload(), 250);
}

function applyContinuousThinkingUi() {
  elements.continuousThinkingToggleBtn.classList.toggle(
    "active",
    state.continuousThinkingEnabled,
  );
  elements.continuousThinkingToggleBtn.setAttribute(
    "aria-pressed",
    String(state.continuousThinkingEnabled),
  );
  elements.continuousThinkingToggleBtn.title = state.continuousThinkingEnabled
    ? "持续思考已开启：引擎会一直分析当前局面"
    : "持续思考已关闭：只有点击提示或战术分析时才会调用引擎";
}

function applyThinkModeUi() {
  const mode = normalizeEngineThinkMode(state.engineThinkMode);
  state.engineThinkMode = mode;
  const focus = mode === ENGINE_THINK_MODES.focus;
  elements.thinkModeFocusBtn.classList.toggle("active", focus);
  elements.thinkModeDistractedBtn.classList.toggle("active", !focus);
  elements.thinkModeFocusBtn.setAttribute("aria-pressed", String(focus));
  elements.thinkModeDistractedBtn.setAttribute(
    "aria-pressed",
    String(!focus),
  );
  elements.thinkModeSwitch.title = focus
    ? "梁圣专注模式：玩家思考时仍持续预判，资源占用最高"
    : "梁子分心模式：玩家思考时停止搜索，落子后才开始计算";
}

function applyLowPowerUi() {
  elements.lowPowerToggleBtn.classList.toggle(
    "active",
    state.lowPowerMode,
  );
  elements.lowPowerToggleBtn.setAttribute(
    "aria-pressed",
    String(state.lowPowerMode),
  );
  elements.lowPowerToggleBtn.title = state.lowPowerMode
    ? "低功耗模式已开启：2 线程、256MB 内存、单路分析，并暂停玩家回合的常驻思考"
    : "低功耗模式：线程降到 2、内存降到 256MB，并切到梁子分心模式";
}

function clearUserPause() {
  state.userPaused = false;
  state.analysisPaused = false;
  state.pausedByVisibility = false;
  updateAnalysisControls();
}

function shouldReleaseEngineOnHumanTurn() {
  const policy = thinkModePolicy(state.engineThinkMode);
  if (!policy.releaseWhileHumanTurn) return false;
  if (state.freePlay || state.matchMode === "human") return true;
  return (
    state.matchMode === "ai" &&
    state.gameStarted &&
    state.turn === state.humanSide
  );
}

function systemResourceContext() {
  return {
    logicalProcessors: state.system?.logicalProcessors ?? 14,
    freeMemoryGB:
      state.system?.freeMemoryGB ??
      state.system?.totalMemoryGB ??
      16,
  };
}

function readResourceInputs() {
  return normalizeResourceSettings(
    {
      threads: elements.threadsInput.value,
      hash: elements.hashInput.value,
      multiPV: elements.multiPvInput.value,
    },
    systemResourceContext(),
  );
}

function writeResourceInputs(settings) {
  const normalized = normalizeResourceSettings(
    settings,
    systemResourceContext(),
  );
  elements.threadsInput.value = String(normalized.threads);
  elements.hashInput.value = String(normalized.hash);
  elements.multiPvInput.value = String(normalized.multiPV);
  elements.threadsInput.dataset.userEdited = "true";
  elements.hashInput.dataset.userEdited = "true";
  updateResourceWarning();
  saveAppSettings();
}

function updateResourceWarning() {
  const settings = readResourceInputs();
  const warnings = collectResourceWarnings({
    ...settings,
    ...systemResourceContext(),
    continuousThinking:
      state.continuousThinkingEnabled || state.engineThinking,
  });
  elements.resourceWarning.hidden = warnings.length === 0;
  elements.resourceWarning.textContent = warnings.length
    ? `资源提示：${warnings.join(" ")}`
    : "";
}

async function applyEngineResourceSettings(
  settings,
  { detail = "性能设置已应用", resume = true } = {},
) {
  const normalized = normalizeResourceSettings(
    settings,
    systemResourceContext(),
  );
  writeResourceInputs(normalized);
  if (!state.engineReady) return normalized;
  await haltEngineSearch({ detail, keepPendingMove: false });
  await api("/api/engine/options", normalized);
  await api("/api/engine/new", {});
  state.engineThinking = false;
  state.analysisActive = false;
  state.analysisStarting = false;
  updateAnalysisControls();
  if (resume && !state.userPaused) await resumeCurrentPosition();
  return normalized;
}

async function setEngineThinkMode(mode) {
  state.engineThinkMode = normalizeEngineThinkMode(mode);
  applyThinkModeUi();
  updateResourceWarning();
  saveAppSettings();

  if (state.engineThinkMode === ENGINE_THINK_MODES.focus) {
    clearUserPause();
    await setContinuousThinkingEnabled(true);
    showToast("已切换到梁圣专注模式：玩家思考时也会保持预判。");
    return;
  }

  state.continuousThinkingEnabled = false;
  applyContinuousThinkingUi();
  updateResourceWarning();
  if (shouldReleaseEngineOnHumanTurn() && !state.engineThinking) {
    await haltEngineSearch({
      detail: "梁子分心模式：玩家回合已释放计算资源",
      keepPendingMove: true,
    });
  }
  showToast("已切换到梁子分心模式：落子后才开始计算电脑那一步。");
}

async function setLowPowerMode(enabled) {
  const next = Boolean(enabled);
  if (next === state.lowPowerMode) {
    applyLowPowerUi();
    return;
  }

  if (next) {
    const current = readResourceInputs();
    state.resourceBaseline = {
      ...current,
      engineThinkMode: state.engineThinkMode,
      continuousThinkingEnabled: state.continuousThinkingEnabled,
    };
    state.lowPowerMode = true;
    state.engineThinkMode = ENGINE_THINK_MODES.distracted;
    state.continuousThinkingEnabled = false;
    applyLowPowerUi();
    applyThinkModeUi();
    applyContinuousThinkingUi();
    saveAppSettings();
    await applyEngineResourceSettings(LOW_POWER_SETTINGS, {
      detail: "低功耗模式已应用",
    });
    showToast("低功耗模式已开启：2 线程、256MB、单路分析。");
    return;
  }

  const savedBaseline = state.resourceBaseline;
  const baseline = normalizeResourceSettings(
    savedBaseline ?? {
      threads: Math.min(64, state.system?.logicalProcessors ?? 14),
      hash: recommendedHash(state.system),
      multiPV: 1,
    },
    systemResourceContext(),
  );
  state.lowPowerMode = false;
  state.resourceBaseline = null;
  state.engineThinkMode = normalizeEngineThinkMode(
    savedBaseline?.engineThinkMode,
  );
  state.continuousThinkingEnabled =
    savedBaseline?.continuousThinkingEnabled === true ||
    state.engineThinkMode === ENGINE_THINK_MODES.focus;
  applyLowPowerUi();
  applyThinkModeUi();
  applyContinuousThinkingUi();
  saveAppSettings();
  await applyEngineResourceSettings(baseline, {
    detail: "已恢复低功耗模式前的参数",
  });
  showToast("低功耗模式已关闭，已恢复之前的引擎参数。");
}

async function resetSystemParameters() {
  const logicalProcessors = state.system?.logicalProcessors ?? 14;
  const defaults = {
    threads: Math.min(64, logicalProcessors),
    hash: recommendedHash(state.system),
    multiPV: 1,
  };
  state.lowPowerMode = false;
  state.resourceBaseline = null;
  applyLowPowerUi();
  await applyEngineResourceSettings(defaults, {
    detail: "系统参数已恢复推荐值",
  });
  showToast(
    `已恢复推荐参数：${defaults.threads} 线程、${defaults.hash}MB、单路分析。`,
  );
}

/**
 * 是否允许"常驻分析"（go infinite）占用引擎。
 *
 * 低功耗模式的意义就是不要一直烧 CPU：此时提示与教练改用一次性有限搜索，
 * 需要长时间思考的只有轮到电脑走子的那一步本身。
 */
function persistentAnalysisAllowed() {
  return !state.lowPowerMode;
}

/**
 * 连续快速落子时合并 FEN 变化，避免引擎指令队列被刷爆。
 */
function shouldKeepAnalyzing() {
  if (!persistentAnalysisAllowed()) return false;
  return Boolean(
    state.continuousThinkingEnabled || state.coachMode || state.hintEnabled,
  );
}

function scheduleContinuousAnalysis(delayMs = CONTINUOUS_THINKING_DEBOUNCE_MS) {
  clearTimeout(continuousThinkingTimer);
  continuousThinkingTimer = setTimeout(() => {
    continuousThinkingTimer = null;
    if (state.userPaused) return;
    if (!analysisAllowed()) return;
    if (!shouldKeepAnalyzing()) return;
    void startContinuousAnalysis({ restart: true });
  }, Math.max(0, Number(delayMs) || 0));
}

/**
 * 取消排队中的一次性提示搜索。
 *
 * 只作废"还没落地的结果"，不打断已经发给引擎的那次搜索；
 * 代次 +1 后，迟到的结果会被丢弃，不会在当前棋盘上画出错误箭头。
 */
function cancelHintOnce() {
  clearTimeout(hintOnceTimer);
  hintOnceTimer = null;
  hintOnceGeneration += 1;
}

/**
 * 低功耗/不常驻分析时的提示方案：只为当前局面跑一次有限搜索。
 *
 * 这样提示功能依然可用，但引擎算完就释放，不会像 go infinite 那样一直占住 CPU。
 */
function scheduleHintOnce(delayMs = CONTINUOUS_THINKING_DEBOUNCE_MS) {
  clearTimeout(hintOnceTimer);
  const generation = ++hintOnceGeneration;
  if (!state.hintEnabled || persistentAnalysisAllowed()) return;
  hintOnceTimer = setTimeout(() => {
    hintOnceTimer = null;
    if (generation !== hintOnceGeneration) return;
    void refreshHintOnce(generation);
  }, Math.max(0, Number(delayMs) || 0));
}

async function refreshHintOnce(generation = hintOnceGeneration) {
  if (!state.hintEnabled || persistentAnalysisAllowed()) return;
  if (!state.engineReady || !hintCanDisplay()) return;
  if (
    state.engineThinking ||
    state.analysisActive ||
    state.analysisStarting ||
    state.pondering
  ) {
    return;
  }
  const position = enginePositionForState({
    freePlay: state.freePlay,
    board: state.board,
    turn: state.turn,
    playStartFen: state.playStartFen,
    moveHistory: state.moveHistory,
  });
  try {
    const result = await api("/api/engine/bestmove", {
      startFen: position.startFen,
      moves: position.moves,
      movetimeMs: HINT_SEARCH_MOVETIME_MS,
    });
    if (generation !== hintOnceGeneration) return;
    if (!state.hintEnabled || persistentAnalysisAllowed()) return;
    if (!hintCanDisplay()) return;
    if (result?.score) elements.scoreValue.textContent = formatScore(result.score);
    if (Number.isFinite(Number(result?.depth))) {
      elements.depthValue.textContent = String(result.depth);
    }
    const bestmove = String(result?.bestmove || "");
    if (!UCI_PATTERN.test(bestmove)) return;
    const move = uciToMove(bestmove);
    if (isLegalMove(state.board, state.turn, move)) setHintMove(move);
  } catch {
    // 一次性提示失败不影响下棋，下一步会再试。
  }
}

async function setContinuousThinkingEnabled(enabled) {
  state.continuousThinkingEnabled = Boolean(enabled);
  applyContinuousThinkingUi();
  updateResourceWarning();
  if (state.continuousThinkingEnabled) {
    clearUserPause();
    updateAnalysisControls();
    scheduleContinuousAnalysis(0);
    return;
  }
  if (!shouldKeepAnalyzing()) {
    // 关掉持续思考只是停分析，不能作废电脑那一步。
    await haltEngineSearch({ detail: "持续思考已关闭", keepPendingMove: true });
  }
}

function updateCommentaryUi() {
  elements.quipToggleBtn.classList.toggle("active", state.quipEnabled);
  elements.quipToggleBtn.setAttribute(
    "aria-pressed",
    String(state.quipEnabled),
  );
  elements.quipToggleBtn.title = state.quipEnabled
    ? "语音吐槽已开启：会分析当前局面，并在落子后优先点评新一步"
    : "语音吐槽已关闭：不会请求短评，也不会加入吐槽语音";
  elements.quipVoiceEnabled.checked = state.quipVoiceEnabled;
  elements.coachVoiceEnabled.checked = state.coachVoiceEnabled;
  elements.speechRateInput.value = String(state.speechRate);
  elements.speechRateValue.textContent = `${state.speechRate.toFixed(1)}×`;
  elements.replayCommentaryBtn.disabled = !state.lastCommentaryText;
}

function stopCommentaryRequests() {
  clearTimeout(analysisCommentaryTimer);
  analysisCommentaryTimer = null;
  commentaryQueue = [];
  commentaryController?.abort();
  commentaryController = null;
  commentaryCurrentTask = null;
}

function setQuipEnabled(enabled) {
  state.quipEnabled = Boolean(enabled);
  updateCommentaryUi();
  saveCommentarySettings();
  if (!state.quipEnabled) {
    stopCommentaryRequests();
    voiceQueue.removePendingChannels("quip");
    return;
  }
  if (!elements.deepseekApiKey.value.trim()) {
    showToast("请先在设置中填写 DeepSeek API Key。", "error");
    setSettingsOpen(true);
    elements.deepseekApiKey.focus();
    return;
  }
  schedulePositionCommentary(0);
}

function applyFreePlayUi() {
  elements.freePlayToggleBtn.classList.toggle("active", state.freePlay);
  elements.freePlayToggleBtn.setAttribute(
    "aria-pressed",
    String(state.freePlay),
  );
  elements.freePlayToggleBtn.title = state.freePlay
    ? "自由行棋已开启：任意一方都能直接落子，用“切换红黑行棋”指定下一手"
    : "允许同一方连续走棋，并用手动按钮切换行棋方";
  elements.switchTurnBtn.disabled = !state.freePlay || state.reviewRunning;
}

async function setFreePlayEnabled(enabled) {
  const next = Boolean(enabled);
  if (next === state.freePlay) return;
  if (state.mode !== "play") {
    await switchMode("play", { resumeAnalysis: false });
  }
  state.freePlay = next;
  applyFreePlayUi();
  await haltEngineSearch({
    detail: next ? "自由行棋已开启" : "自由行棋已关闭",
  });
  state.selected = null;
  state.legalMoves = [];
  state.analysisPaused = false;
  state.analysisFen = "";
  state.analysisInfo = null;
  if (next) {
    state.freePlayStartFen = boardToFen(state.board, state.turn);
    state.freeMoves = [];
    state.moveEvaluations = [];
    state.history = [];
    renderLastMoveEvaluation(null);
    showToast("自由行棋已开启，可以直接移动任意一方的棋子。");
  } else {
    // 关闭自由行棋时，以当前局面作为新的起点，清空之前的走法序列，
    // 避免引擎和棋谱因为“同一方连走”而判定非法。
    state.playStartFen = boardToFen(state.board, state.turn);
    state.moveHistory = [];
    state.freeMoves = [];
    state.freePlayStartFen = "";
    state.history = [];
    state.personaHistory = [];
    state.personaDecision = null;
    if (state.engineReady) {
      try {
        await api("/api/engine/new", {});
      } catch {
        // 引擎重置失败不影响棋盘。
      }
    }
    showToast("已退出自由行棋，当前局面作为新的起点。");
  }
  renderAll();
  if (state.continuousThinkingEnabled) scheduleContinuousAnalysis(0);
}

async function switchTurnSide() {
  if (!state.freePlay) {
    showToast("请先开启自由行棋模式。", "error");
    return;
  }
  if (state.engineThinking) {
    showToast("引擎正在计算走子，请稍候。", "error");
    return;
  }
  state.turn = opposite(state.turn);
  state.selected = null;
  state.legalMoves = [];
  state.analysisPaused = false;
  state.analysisFen = "";
  state.analysisInfo = null;
  refreshGameStatus();
  renderBoard();
  await haltEngineSearch({ detail: "已手动切换行棋方" });
  state.analysisPaused = false;
  if (state.continuousThinkingEnabled) scheduleContinuousAnalysis(0);
  showToast(`已切换为${state.turn === RED ? "红方" : "黑方"}行棋。`);
}

async function setMatchMode(mode) {
  state.matchMode = mode === "human" ? "human" : "ai";
  elements.matchModeSelect.value = state.matchMode;
  elements.humanSideSelect.disabled = state.matchMode === "human";
  saveAppSettings();
  if (state.matchMode === "human") {
    await haltEngineSearch({ detail: "双人同机对弈" });
    state.analysisPaused = false;
    renderAll();
    if (state.gameStarted && state.continuousThinkingEnabled) {
      scheduleContinuousAnalysis(0);
    }
    showToast("已切换为双人对弈：引擎只做分析与教练，不会自动落子。");
    return;
  }
  renderAll();
  showToast("已切换为人机对弈。");
  if (state.gameStarted && state.turn !== state.humanSide) {
    await requestEngineMove();
  } else if (state.gameStarted && state.continuousThinkingEnabled) {
    scheduleContinuousAnalysis(0);
  }
}

/* ------------------------------- 教练模式 ------------------------------- */

function coachStateLabel() {
  if (state.coachAnalyzing) return "分析中";
  if (state.coachMode) return "已开启";
  return "未开启";
}

function updateCoachUi() {
  const manualTrigger = state.coachTrigger !== "every-move";
  const hasEvaluation = state.moveEvaluations.some(
    (entry) => entry?.status === "ok",
  );
  elements.coachModeToggleBtn.classList.toggle("active", state.coachMode);
  elements.coachModeToggleBtn.setAttribute(
    "aria-pressed",
    String(state.coachMode),
  );
  elements.coachModeToggleBtn.title = state.coachMode
    ? "教练模式已开启：引擎只做讲解与分析"
    : "开启后引擎在后台分析，但不会替你落子";
  elements.coachPanel.hidden = !state.coachMode;
  elements.coachManualModeBtn.classList.toggle("active", manualTrigger);
  elements.coachManualModeBtn.setAttribute(
    "aria-pressed",
    String(manualTrigger),
  );
  elements.coachAutoModeBtn.classList.toggle("active", !manualTrigger);
  elements.coachAutoModeBtn.setAttribute(
    "aria-pressed",
    String(!manualTrigger),
  );
  elements.coachAnalyzeBtn.disabled = !state.coachMode || state.coachAnalyzing;
  elements.coachAnalyzeLastBtn.disabled =
    !state.coachMode || state.coachAnalyzing || !hasEvaluation;
  elements.coachStateText.textContent = coachStateLabel();
}

async function setCoachModeEnabled(enabled) {
  state.coachMode = Boolean(enabled);
  // 每次开关都推进代次：旧报告、旧语音、排队中的旧分析全部作废，
  // 避免“关掉再打开”后过期的结果盖在新报告上。
  coachAnalysisGeneration += 1;
  cancelPendingCoachAnalysis();
  updateCoachUi();
  if (state.coachMode) {
    if (analysisAllowed() && !state.analysisPaused) scheduleContinuousAnalysis(0);
    showToast("教练模式已开启：引擎只做分析，不会替你落子。");
    return;
  }
  if (!shouldKeepAnalyzing()) {
    // 关掉教练模式只是停分析，不能作废电脑那一步。
    await haltEngineSearch({ detail: "教练模式已关闭", keepPendingMove: true });
  } else if (analysisAllowed()) {
    // 持续思考/提示仍在开启时，教练分析打断过的无限搜索要接续回来。
    scheduleContinuousAnalysis(0);
  }
  showToast("教练模式已关闭。");
}

function cancelPendingCoachAnalysis() {
  const pending = coachAnalysisQueue;
  coachAnalysisQueue = [];
  for (const task of pending) {
    try {
      task.resolve(null);
    } catch {
      // 单个任务回调异常不应影响其它任务清理。
    }
  }
  clearInterval(coachTypeTimer);
  coachTypeTimer = null;
  state.coachAnalyzing = false;
  voiceQueue.removePendingChannels("coach");
}

function setCoachTrigger(trigger) {
  state.coachTrigger =
    trigger === "every-move" ? "every-move" : "manual";
  saveCommentarySettings();
  updateCoachUi();
  showToast(
    state.coachTrigger === "every-move"
      ? "教练模式会在每步落子后自动分析。"
      : "教练模式改为手动分析。",
  );
}

function typeCoachReport(text) {
  clearInterval(coachTypeTimer);
  coachTypeTimer = null;
  const full = typeof text === "string" ? text : String(text ?? "");
  if (!full) {
    elements.coachReport.textContent = "暂时没有得到分析内容。";
    return;
  }
  let index = 0;
  elements.coachReport.textContent = "";
  coachTypeTimer = setInterval(() => {
    index += 2;
    elements.coachReport.textContent = full.slice(0, index);
    if (index >= full.length) {
      clearInterval(coachTypeTimer);
      coachTypeTimer = null;
      elements.coachReport.textContent = full;
    }
  }, 24);
}

function buildCoachContext(engineInfo) {
  const lastEntry = state.moveEvaluations[state.moveEvaluations.length - 1] ?? null;
  const moveCount = state.freePlay
    ? state.freeMoves.length
    : state.moveHistory.length;
  return {
    fen: boardToFen(state.board, state.turn),
    turn: state.turn,
    lastMove: state.lastMove
      ? {
          side: state.lastMoveSide || lastEntry?.side || "",
          notation: state.lastMoveNotation || lastEntry?.notation || "",
          description: state.lastMoveText || "",
        }
      : null,
    engine: {
      bestMove: engineInfo?.bestMove || engineInfo?.bestmove || "",
      bestChinese: engineInfo?.bestNotation || "",
      score: engineInfo?.score ? formatScore(engineInfo.score) : "",
      depth:
        engineInfo?.depth != null && Number.isFinite(Number(engineInfo.depth))
          ? String(engineInfo.depth)
          : "",
      principalVariation: Array.isArray(engineInfo?.pv)
        ? formatPv(engineInfo.pv)
        : "",
    },
    moveCount,
    gameState:
      state.status.reason ||
      (state.status.state === "playing" ? "进行中" : state.status.state),
  };
}

async function runCoachAnalysisLegacy() {
  const apiKey = elements.deepseekApiKey.value.trim();
  if (!apiKey) {
    showToast("请先在设置中填写 DeepSeek API Key。", "error");
    setSettingsOpen(true);
    elements.deepseekApiKey.focus();
    return;
  }
  if (state.coachAnalyzing) return;
  state.coachAnalyzing = true;
  updateCoachUi();
  elements.coachReport.textContent = "正在整理当前局面与引擎意见…";
  try {
    let engineInfo = null;
    if (state.engineReady) {
      const position = enginePositionForState({
        freePlay: state.freePlay,
        board: state.board,
        turn: state.turn,
        playStartFen: state.playStartFen,
        moveHistory: state.moveHistory,
      });
      try {
        engineInfo = await api("/api/engine/bestmove", {
          startFen: position.startFen,
          moves: position.moves,
          movetimeMs: MOVE_EVALUATION_MOVETIME_MS,
        });
        if (UCI_PATTERN.test(engineInfo?.bestmove || "")) {
          engineInfo.bestNotation = describeUciOnFen(
            boardToFen(state.board, state.turn),
            engineInfo.bestmove,
          );
        }
      } catch {
        engineInfo = null;
      }
    }
    const result = await api("/api/coach/analysis", {
      apiKey,
      model: elements.deepseekModel.value.trim() || "deepseek-flash",
      context: buildCoachContext(engineInfo),
    });
    typeCoachReport(result.text);
    showToast("战术分析完成。");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.coachReport.textContent = message;
    showToast(message, "error");
  } finally {
    state.coachAnalyzing = false;
    updateCoachUi();
  }
}

function coachSpeechSummary(text) {
  const compact = String(text || "")
    .replace(/[#*`>_\-\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  const sentences = compact
    .split(/[。！？!?]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  let summary = sentences[0] || compact;
  if (summary.length < 50 && sentences[1]) {
    summary = `${summary}。${sentences[1]}`;
  }
  if (summary.length > 80) summary = summary.slice(0, 80);
  if (!/[。！？!?]$/.test(summary)) summary += "。";
  return summary;
}

function enqueueCoachAnalysis({
  scope = "current",
  auto = false,
  generation = commentaryGeneration,
} = {}) {
  return new Promise((resolve) => {
    coachAnalysisQueue.push({
      scope,
      auto,
      generation,
      lifecycle: coachAnalysisGeneration,
      resolve,
    });
    void processCoachAnalysisQueue();
  });
}

async function processCoachAnalysisQueue() {
  if (coachAnalysisRunning) return;
  coachAnalysisRunning = true;
  try {
    while (coachAnalysisQueue.length) {
      const task = coachAnalysisQueue.shift();
      try {
        task.resolve(await performCoachAnalysis(task));
      } catch (error) {
        task.resolve(null);
      }
    }
  } finally {
    coachAnalysisRunning = false;
    if (coachAnalysisQueue.length) {
      queueMicrotask(() => void processCoachAnalysisQueue());
    }
  }
}

async function performCoachAnalysis({ scope, auto, generation, lifecycle }) {
  const stale = () =>
    lifecycle !== coachAnalysisGeneration ||
    !state.coachMode ||
    generation !== commentaryGeneration;
  const apiKey = elements.deepseekApiKey.value.trim();
  if (!apiKey) {
    showToast("请先在设置中填写 DeepSeek API Key。", "error");
    setSettingsOpen(true);
    elements.deepseekApiKey.focus();
    return null;
  }
  if (stale()) return null;

  const startFen = boardToFen(state.board, state.turn);
  state.coachAnalyzing = true;
  updateCoachUi();
  elements.coachReport.textContent = "正在整理当前局面与引擎意见…";
  try {
    let engineInfo = null;
    const lastEntry = state.moveEvaluations[state.moveEvaluations.length - 1];
    if (scope === "last" && lastEntry) {
      engineInfo = {
        bestmove: lastEntry.bestUci,
        bestNotation: lastEntry.bestNotation,
        score: lastEntry.bestScore,
        depth: lastEntry.depth,
      };
    } else if (state.engineReady) {
      try {
        engineInfo = await api("/api/engine/bestmove", {
          startFen,
          moves: [],
          movetimeMs: MOVE_EVALUATION_MOVETIME_MS,
        });
        if (UCI_PATTERN.test(engineInfo?.bestmove || "")) {
          engineInfo.bestNotation = describeUciOnFen(
            startFen,
            engineInfo.bestmove,
          );
        }
      } catch {
        engineInfo = null;
      }
    }

    if (stale()) return null;
    if (boardToFen(state.board, state.turn) !== startFen) return null;
    const result = await api("/api/coach/analysis", {
      apiKey,
      model: elements.deepseekModel.value.trim() || "deepseek-flash",
      context: buildCoachContext(engineInfo),
    });
    if (stale()) return null;
    if (boardToFen(state.board, state.turn) !== startFen) return null;

    state.coachReportText = String(result.text || "").trim();
    typeCoachReport(state.coachReportText);
    if (state.coachVoiceEnabled) {
      const summary = coachSpeechSummary(state.coachReportText);
      if (summary) {
        speakCommentary(summary, {
          channel: "coach",
          priority: auto
            ? VOICE_PRIORITY.AUTO_COACH
            : VOICE_PRIORITY.MANUAL_COACH,
          auto,
          generation,
        });
      }
    }
    showToast("战术分析完成。");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!stale()) elements.coachReport.textContent = message;
    showToast(message, "error");
    return null;
  } finally {
    if (lifecycle === coachAnalysisGeneration) {
      state.coachAnalyzing = false;
      updateCoachUi();
    }
    // 教练分析用有限搜索完成，会打断 go infinite；只要持续思考/提示仍开启就接回来。
    if (shouldKeepAnalyzing() && analysisAllowed()) scheduleContinuousAnalysis(0);
  }
}

function runCoachAnalysis(options = {}) {
  return enqueueCoachAnalysis(options);
}

function resetCurrentPosition() {
  advanceCommentaryPosition();
  setHintMove(null);
  state.playStartFen = boardToFen(state.board, state.turn);
  state.freePlayStartFen = state.freePlay
    ? boardToFen(state.board, state.turn)
    : "";
  state.moveHistory = [];
  state.freeMoves = [];
  state.moveEvaluations = [];
  state.personaHistory = [];
  state.personaDecision = null;
  state.history = [];
  state.lastMove = null;
  state.lastMoveText = "尚未走棋";
  state.selected = null;
  state.legalMoves = [];
  state.analysisFen = "";
  state.analysisInfo = null;
  state.evaluationGeneration = (state.evaluationGeneration ?? 0) + 1;
  state.engineGeneration += 1;
  // 局面已经变样，任何在途的电脑走子都必须作废，否则会落到新局面上。
  state.moveGeneration += 1;
  renderLastMoveEvaluation(null);
}

/* ---------------------------- 上一步棋智能评估 ---------------------------- */

const MAX_VISIBLE_EVALUATIONS = 10;
const UCI_PATTERN = /^[a-i][0-9][a-i][0-9]$/;

function evaluationSideName(side) {
  if (side === RED) return "红方";
  if (side === BLACK) return "黑方";
  return "";
}

function formatLossText(loss) {
  const value = Number(loss);
  if (!Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.round(value))} 分`;
}

function evaluationSummary(entry) {
  const side = evaluationSideName(entry.side);
  const ply = Number.isFinite(Number(entry.ply)) ? `第 ${entry.ply} 手` : "";
  return [side, ply].filter(Boolean).join(" · ") || "上一步";
}

function describeUciOnFen(fen, uci) {
  if (!UCI_PATTERN.test(uci || "")) return "";
  try {
    const parsed = parseFen(fen);
    return formatMoveNotation(parsed.board, uciToMove(uci));
  } catch {
    return "";
  }
}

function renderLastMoveHistory() {
  const list = Array.isArray(state.moveEvaluations)
    ? state.moveEvaluations
    : [];
  if (!list.length) {
    elements.lastMoveHistory.hidden = true;
    elements.lastMoveHistoryList.innerHTML = "";
    return;
  }
  elements.lastMoveHistory.hidden = false;
  elements.lastMoveHistoryList.innerHTML = "";
  for (const entry of list.slice(-MAX_VISIBLE_EVALUATIONS)) {
    const chip = document.createElement("span");
    const grade = entry.grade || "neutral";
    chip.style.setProperty("--grade-color", entry.color || gradeColor(grade));
    chip.title = entry.label || gradeLabel(grade);
    const side = evaluationSideName(entry.side);
    const notation = entry.notation || entry.uci || "?";
    const loss = Number(entry.loss);
    const lossText =
      entry.status === "pending"
        ? "…"
        : entry.status === "error" || !Number.isFinite(loss)
          ? "—"
          : `-${Math.max(0, Math.round(loss))}`;
    chip.textContent = `${[side, notation].filter(Boolean).join(" ")} ${lossText}`;
    elements.lastMoveHistoryList.append(chip);
  }
}

/**
 * 刷新"上一步评估"面板。
 *
 * record 传 null 表示清空；不传则显示最近一条评估记录。
 */
function renderLastMoveEvaluation(record) {
  let entry = null;
  if (record === null) {
    entry = null;
  } else if (record) {
    entry = record;
  } else {
    const list = Array.isArray(state.moveEvaluations)
      ? state.moveEvaluations
      : [];
    entry = list[list.length - 1] ?? null;
  }

  if (!entry) {
    elements.lastMoveGrade.textContent = "尚未评估";
    elements.lastMoveGrade.className = "grade-pill";
    elements.lastMoveGrade.style.removeProperty("--grade-color");
    elements.lastMoveSideLabel.textContent = "等待落子";
    elements.lastMoveActual.textContent = "-";
    elements.lastMoveBest.textContent = "-";
    elements.lastMoveLoss.textContent = "-";
    renderLastMoveHistory();
    return;
  }

  const grade = entry.grade || "neutral";
  const label =
    entry.status === "error"
      ? "评估失败"
      : entry.status === "pending"
        ? "评估中"
        : entry.label || gradeLabel(grade);
  elements.lastMoveGrade.textContent = label;
  elements.lastMoveGrade.className = "grade-pill";
  elements.lastMoveGrade.style.setProperty(
    "--grade-color",
    entry.color || gradeColor(grade),
  );
  elements.lastMoveSideLabel.textContent = evaluationSummary(entry);
  elements.lastMoveActual.textContent = entry.notation || entry.uci || "-";
  elements.lastMoveBest.textContent =
    entry.bestNotation || entry.bestUci || "—";
  elements.lastMoveLoss.textContent =
    entry.status === "pending" ? "分析中…" : formatLossText(entry.loss);
  renderLastMoveHistory();
}

/**
 * 用引擎评估刚落下的一手棋：fenBefore 求最优、fenAfter 求走后局面最优，
 * 通过 calculateMoveLoss 得到损失并分级。整个过程串行，不并发调用引擎。
 */
async function evaluateLastMove({
  fenBefore,
  fenAfter,
  move,
  description,
  movingSide,
  source,
}) {
  if (!state.engineReady || !fenBefore || !fenAfter) return null;
  const uci = moveToUci(move);
  const generation = state.evaluationGeneration ?? 0;
  const pending = {
    ply: state.moveEvaluations.length + 1,
    side: movingSide,
    uci,
    notation: description,
    fenBefore,
    fenAfter,
    source,
    status: "pending",
    grade: "neutral",
    label: "评估中",
    color: gradeColor("neutral"),
    loss: null,
  };
  state.moveEvaluations.push(pending);
  renderLastMoveEvaluation(pending);

  let bestInfo = null;
  let afterInfo = null;
  state.evaluationBusy = true;
  try {
    bestInfo = await api("/api/engine/bestmove", {
      startFen: fenBefore,
      moves: [],
      movetimeMs: MOVE_EVALUATION_MOVETIME_MS,
    });
    afterInfo = await api("/api/engine/bestmove", {
      startFen: fenAfter,
      moves: [],
      movetimeMs: MOVE_EVALUATION_MOVETIME_MS,
    });
  } catch (error) {
    pending.status = "error";
    pending.label = "评估失败";
    if (generation === (state.evaluationGeneration ?? 0)) {
      renderLastMoveEvaluation(pending);
      updateCoachUi();
    }
    return null;
  } finally {
    state.evaluationBusy = false;
  }

  if (generation !== (state.evaluationGeneration ?? 0)) {
    // 局面已经悔棋 / 重置 / 切换，丢弃过期结果。
    return null;
  }

  const bestUci =
    typeof bestInfo?.bestmove === "string" ? bestInfo.bestmove : "";
  const loss = calculateMoveLoss(bestInfo?.score, afterInfo?.score);
  const classification = classifyMove(loss, bestInfo, afterInfo, uci, bestUci);
  Object.assign(pending, {
    status: "ok",
    grade: classification.grade,
    label: classification.label,
    color: classification.color,
    loss: classification.loss,
    bestUci: UCI_PATTERN.test(bestUci) ? bestUci : "",
    bestNotation: describeUciOnFen(fenBefore, bestUci),
    bestScore: bestInfo?.score ?? null,
    afterScore: afterInfo?.score ?? null,
    reason: classification.reason,
  });
  renderLastMoveEvaluation(pending);
  updateCoachUi();
  return pending;
}

/* --------------------------- 预判续算（超级大师） --------------------------- */

/**
 * 背景：持续思考开着的时候，玩家可能盯着棋盘想两分钟。
 * 旧做法是这两分钟只分析"玩家该走哪一步"，玩家一落子就把这一切全丢掉，
 * 再 position + go 从零重算 —— 超级大师设的长时间基本浪费掉了。
 *
 * 新做法（UCI ponder，只给超级大师开）：
 *   1. 轮到玩家时，先花 0.3~1.5 秒"侦察"出玩家最可能走的那一步；
 *   2. 直接在那个子局面上开 go ponder movetime <用户设置的思考时间>；
 *   3. 玩家真的走了这一步 → ponderhit，引擎沿用它已经算出来的搜索树、
 *      深度与哈希表，只补完剩下的思考时间（想得越久，机器落子越快）；
 *   4. 玩家走了别的着法 → ponderstop，再按常规流程重新搜索。
 *
 * 其他人格每步本来就只想几十毫秒到两秒，续算省不下多少时间却要多发一组
 * 指令，所以保持原样（见 src/think-time.js 的 supportsPonder）。
 */

function forecastEligible() {
  if (
    !state.engineReady ||
    state.mode !== "play" ||
    state.status.state !== "playing" ||
    state.engineThinking ||
    state.analysisPaused ||
    state.userPaused ||
    state.pondering
  ) {
    return false;
  }
  // 预判续算的前提是"电脑在替我思考"，双人同机 / 自由行棋 / 未开对局都不适用。
  if (!state.gameStarted || state.freePlay || state.matchMode !== "ai") {
    return false;
  }
  if (state.turn !== state.humanSide) return false;
  if (state.engineThinkMode !== ENGINE_THINK_MODES.focus) return false;
  // 跟着【持续思考】开关走；只开提示/教练时仍用普通的持续分析。
  if (!state.continuousThinkingEnabled) return false;
  return supportsPonder(effectivePersona());
}

function clearForecastState() {
  state.pondering = false;
  state.forecastStarting = false;
  state.ponderMove = "";
  state.ponderReply = "";
  state.ponderNotation = "";
  state.ponderReplyNotation = "";
  state.ponderStartedAt = 0;
  state.ponderDepth = 0;
}

function renderForecastChip() {
  if (!state.pondering) return;
  const parts = ["预判续算"];
  if (state.ponderNotation) parts.push(`对方 ${state.ponderNotation}`);
  if (state.ponderReplyNotation) parts.push(`我方 ${state.ponderReplyNotation}`);
  if (state.ponderDepth) parts.push(`深度 ${state.ponderDepth}`);
  if (state.ponderStartedAt) {
    const seconds = Math.floor((Date.now() - state.ponderStartedAt) / 1000);
    if (seconds >= 1) parts.push(`${seconds} 秒`);
  }
  elements.analysisStateChip.textContent = parts.join(" · ");
}

function setAnalysisChipIdle() {
  elements.analysisStateChip.textContent = state.analysisActive
    ? "持续分析"
    : "待分析";
}

/**
 * 停掉正在进行的预判（如果引擎里还有的话），并清空相关状态。
 * 返回"之前是否真的有预判在跑"。
 */
async function stopForecast({ silent = false } = {}) {
  const wasPondering = state.pondering;
  const wasAnalyzing = state.analysisActive || state.analysisStarting;
  state.pondering = false;
  state.ponderGeneration += 1;
  try {
    if (wasPondering) {
      await api("/api/engine/ponderstop", {});
    } else if (wasAnalyzing) {
      await api("/api/engine/stop", {});
    }
  } catch {
    // 引擎可能已经自己结束了这一步搜索，忽略即可。
  }
  clearForecastState();
  if (wasPondering || wasAnalyzing) {
    state.analysisActive = false;
    state.analysisStarting = false;
  }
  if (!silent) setAnalysisChipIdle();
  updateAnalysisControls();
  return wasPondering;
}

/**
 * 开启预判续算：侦察 → 在预判子局面上 go ponder。
 * 任何一步不成立都安静地退回普通的 go infinite 分析，绝不把棋盘卡住。
 */
async function startForecastAnalysis() {
  if (state.forecastStarting) return false;
  state.forecastStarting = true;
  try {
    await stopForecast({ silent: true });
    if (!forecastEligible()) return false;
    state.ponderGeneration += 1;
    const generation = state.ponderGeneration;
    const persona = effectivePersona();
    const position = enginePositionForState({
      freePlay: state.freePlay,
      board: state.board,
      turn: state.turn,
      playStartFen: state.playStartFen,
      moveHistory: state.moveHistory,
    });
    const scoutMs = resolveForecastScoutMs(state.thinkTimeMs);
    setEngineState("analyzing", `${persona.name} · 正在侦察玩家的着法`);
    const scout = await api("/api/engine/go", {
      startFen: position.startFen,
      moves: position.moves,
      maxThinkMs: scoutMs,
      personaId: state.personaId,
      personaIntent: "persona",
      personaTraits: activePersonaTraits(),
      personaController: activePersonaController(),
      personaOverrides: personaRequestOverrides(),
      categoryHistory: state.personaHistory,
    });
    if (generation !== state.ponderGeneration) return false;

    const predictedUci =
      typeof scout?.bestmove === "string" ? scout.bestmove : "";
    const predictedMove = UCI_PATTERN.test(predictedUci)
      ? uciToMove(predictedUci)
      : null;
    // 引擎给的预判必须是当前局面上真正合法的着法，否则宁可退回去做普通分析。
    const legal =
      Boolean(predictedMove) &&
      isLegalMove(state.board, state.turn, predictedMove);
    if (!legal) return startInfiniteAnalysis({ restart: true });

    const predictedNotation = formatMoveNotation(state.board, predictedMove);
    const childFen = boardToFen(
      applyMove(state.board, predictedMove),
      opposite(state.turn),
    );
    const replyUci = typeof scout?.ponder === "string" ? scout.ponder : "";
    const replyNotation = UCI_PATTERN.test(replyUci)
      ? describeUciOnFen(childFen, replyUci)
      : "";

    const started = await api("/api/engine/ponder", {
      startFen: childFen,
      moves: [],
      maxThinkMs: state.thinkTimeMs,
      personaId: state.personaId,
      personaOverrides: personaRequestOverrides(),
    });
    if (generation !== state.ponderGeneration) {
      // 期间局面已经变了：把这个没人要的预判收掉。
      void api("/api/engine/ponderstop", {}).catch(() => {});
      return false;
    }
    if (!started?.pondering) return startInfiniteAnalysis({ restart: true });

    state.pondering = true;
    state.ponderMove = predictedUci;
    state.ponderReply = replyUci;
    state.ponderNotation = predictedNotation;
    state.ponderReplyNotation = replyNotation;
    state.ponderStartedAt = Date.now();
    state.ponderDepth = 0;
    state.analysisActive = true;
    state.analysisStarting = false;
    state.analysisFen = position.startFen;
    state.analysisInfo = null;

    // 侦察那一次搜索的结果顺手补进面板与提示，界面不会因为"在预判"而空着。
    const scoutInfo = Array.isArray(scout?.candidates)
      ? scout.candidates[0]
      : null;
    if (scoutInfo?.score) {
      elements.scoreValue.textContent = formatScore(scoutInfo.score);
    }
    if (Array.isArray(scoutInfo?.pv) && scoutInfo.pv.length) {
      elements.pvText.textContent = formatPv(scoutInfo.pv);
    }
    if (hintCanDisplay()) setHintMove(predictedMove);
    renderForecastChip();
    updateAnalysisControls();
    setEngineState(
      "analyzing",
      `${persona.name} · 预判续算（预算 ${formatThinkTime(state.thinkTimeMs)}）`,
    );
    return true;
  } catch (error) {
    showToast(
      `预判续算未能开启，已切回持续分析：${
        error instanceof Error ? error.message : String(error)
      }`,
      "info",
    );
    try {
      return await startInfiniteAnalysis({ restart: true });
    } catch {
      return false;
    }
  } finally {
    state.forecastStarting = false;
    updateAnalysisControls();
  }
}

/**
 * 玩家真的走了预判着法：ponderhit，让引擎用已经算好的搜索树把这手交出来。
 * 返回可以直接落子的着法；任何异常都返回 null，由调用方退回常规搜索。
 */
async function resolveForecastHit() {
  // 用 moveGeneration：暂停分析/切后台不该作废这一步，只有悔棋、载入、
  // 编辑、重开这类真正改变局面的操作才会让它 +1。
  const inheritGeneration = state.moveGeneration;
  const persona = effectivePersona();
  setEngineState("thinking", `${persona.name} · 继承预判续算`);
  elements.analysisStateChip.textContent = "预判命中 · 继承计算中";
  let bestmove = "";
  try {
    const result = await api("/api/engine/ponderhit", {});
    bestmove = typeof result?.bestmove === "string" ? result.bestmove : "";
  } catch {
    bestmove = "";
  } finally {
    clearForecastState();
    state.analysisActive = false;
    state.analysisStarting = false;
    updateAnalysisControls();
  }
  if (inheritGeneration !== state.moveGeneration) return null;
  if (!UCI_PATTERN.test(bestmove)) return null;
  try {
    const move = uciToMove(bestmove);
    return isLegalMove(state.board, state.turn, move) ? move : null;
  } catch {
    return null;
  }
}

function analysisAllowed() {
  if (
    !state.engineReady ||
    state.mode !== "play" ||
    state.status.state !== "playing" ||
    state.engineThinking ||
    state.analysisPaused ||
    state.userPaused
  ) {
    return false;
  }
  // 自由行棋随时可以分析当前局面，不必先"开始对局"。
  if (state.freePlay) return true;
  // 双人同机对局开始后，轮到谁就为谁分析。
  if (state.matchMode === "human") return state.gameStarted;
  // 人机对弈只在我方行棋时做后台分析。
  return state.gameStarted && state.turn === state.humanSide;
}

function updateAnalysisControls() {
  const canControl =
    !state.reviewRunning &&
    state.engineReady &&
    state.mode === "play" &&
    state.status.state === "playing" &&
    (state.gameStarted || state.freePlay || state.engineThinking);
  elements.stopBtn.disabled = !canControl;
  elements.stopBtnLabel.textContent = state.engineThinking
    ? "停止思考"
    : state.analysisPaused
      ? "继续分析"
      : "暂停分析";
}

async function haltEngineSearch({
  detail = "已停止",
  pause = false,
  // 仅仅停止"分析"时不应作废正在进行的引擎走子。
  // 暂停持续分析、切到后台、关闭教练/持续思考开关都走 keepPendingMove: true；
  // 只有悔棋/载入/编辑/重开这类真正会改变局面的操作才用默认值作废走子。
  keepPendingMove = false,
} = {}) {
  const wasPondering = state.pondering;
  const wasSearching =
    state.engineThinking ||
    state.analysisActive ||
    state.analysisStarting ||
    wasPondering;
  setHintMove(null);
  if (pause) state.analysisPaused = true;
  clearPositionCommentarySchedule();
  state.engineGeneration += 1;
  if (!keepPendingMove) state.moveGeneration += 1;
  // 预判续算同样属于"分析"，停止分析时代次 +1，正在等待的 ponderhit 会被丢弃。
  state.ponderGeneration += 1;
  state.pondering = false;
  state.engineThinking = false;
  state.analysisActive = false;
  state.analysisStarting = false;
  clearForecastState();
  setAnalysisChipIdle();
  updateAnalysisControls();

  if (wasSearching) {
    try {
      if (wasPondering) {
        await api("/api/engine/ponderstop", {});
      } else {
        await api("/api/engine/stop", {});
      }
    } catch {
      // The engine may have completed the search already.
    }
  }
  setEngineState("ready", detail);
}

/**
 * 统一的"开始分析当前局面"入口。
 *
 * 符合条件时走预判续算（超级大师 + 持续思考），否则就是原来的 go infinite。
 * 之所以放在这里统一分派，是因为分析有十来处入口（落子后、悔棋后、切回前台、
 * 打开辅助开关……），分散判断迟早会漏掉一处。
 */
async function startContinuousAnalysis({ restart = false } = {}) {
  if (forecastEligible()) {
    const started = await startForecastAnalysis();
    if (started) return true;
    if (!forecastEligible()) return startInfiniteAnalysis({ restart });
    return false;
  }
  return startInfiniteAnalysis({ restart });
}

async function startInfiniteAnalysis({ restart = false } = {}) {
  // 预判续算正在跑时不能抢占：普通分析会 stop 掉引擎，把搜索树一起丢掉。
  if (state.pondering) return false;
  refreshGameStatus();
  if (!analysisAllowed()) return false;
  if (!restart && (state.analysisActive || state.analysisStarting)) {
    return state.analysisActive;
  }

  const generation = ++state.engineGeneration;
  state.analysisStarting = true;
  updateAnalysisControls();
  try {
    // 自由行棋等场景下同一局面可能被反复要求重新分析，先显式 stop，
    // 否则引擎会以 already 直接返回，界面看起来像"没有反应"。
    if (restart && (state.analysisActive || state.analysisStarting)) {
      try {
        await api("/api/engine/stop", {});
      } catch {
        // 引擎可能已经空闲，忽略即可。
      }
      state.analysisActive = false;
    }
    const position = enginePositionForState({
      freePlay: state.freePlay,
      board: state.board,
      turn: state.turn,
      playStartFen: state.playStartFen,
      moveHistory: state.moveHistory,
    });
    const result = await api("/api/engine/analyze", {
      startFen: position.startFen,
      moves: position.moves,
    });
    if (generation !== state.engineGeneration) return false;
    state.analysisActive = Boolean(result.analysis || result.already);
    state.analysisFen = position.startFen;
    if (state.analysisActive) {
      setEngineState("analyzing", "持续分析当前局面");
    } else if (result.busy) {
      setEngineState("ready", "引擎正在计算走子");
    }
    return state.analysisActive;
  } catch (error) {
    if (generation === state.engineGeneration) {
      state.analysisActive = false;
      showToast(error instanceof Error ? error.message : String(error), "error");
    }
    return false;
  } finally {
    if (generation === state.engineGeneration) {
      state.analysisStarting = false;
      updateAnalysisControls();
    }
  }
}

async function resumeCurrentPosition() {
  if (
    state.userPaused ||
    !state.engineReady ||
    state.mode !== "play" ||
    state.status.state !== "playing"
  ) {
    return false;
  }
  if (state.freePlay) {
    if (shouldKeepAnalyzing()) {
      return startContinuousAnalysis({ restart: true });
    }
    if (state.hintEnabled) scheduleHintOnce(0);
    return false;
  }
  if (!state.gameStarted) return false;
  if (state.matchMode === "human") {
    // 双人同机：只有主动开启持续思考或教练模式时才调用引擎。
    if (shouldKeepAnalyzing()) {
      return startContinuousAnalysis({ restart: true });
    }
    if (state.hintEnabled) scheduleHintOnce(0);
    return false;
  }
  if (state.turn === state.humanSide) {
    if (shouldKeepAnalyzing()) {
      return startContinuousAnalysis({ restart: true });
    }
    // 低功耗/分心：提示只用一次性有限搜索，不做常驻分析。
    if (state.hintEnabled) scheduleHintOnce(0);
    return false;
  }
  await requestEngineMove();
  return true;
}

async function stopEngineSearch() {
  if (state.userPaused) {
    clearUserPause();
    updateAnalysisControls();
    if (
      state.pendingEngineMove &&
      state.gameStarted &&
      !state.freePlay &&
      state.matchMode === "ai" &&
      state.turn !== state.humanSide
    ) {
      state.pendingEngineMove = false;
      await requestEngineMove();
    } else {
      state.pendingEngineMove = false;
      await resumeCurrentPosition();
    }
    return;
  }

  state.userPaused = true;
  state.pendingEngineMove = Boolean(
    state.engineThinking ||
      (state.gameStarted &&
        !state.freePlay &&
        state.matchMode === "ai" &&
        state.turn !== state.humanSide),
  );
  updateAnalysisControls();
  await haltEngineSearch({
    detail: "已停止：在你点击“继续分析”前不会自动思考",
    keepPendingMove: true,
  });
  showToast("已彻底停止。后续落子也不会自动恢复，点击“继续分析”才会继续。");
}

async function requestEngineMove(force = false) {
  if (!state.gameStarted && !force) return;
  if (!state.engineReady) {
    showToast("棋力引擎仍在准备。", "error");
    return;
  }
  if (state.userPaused && !force) return;
  if (state.engineThinking) return;
  if (!force && state.turn === state.humanSide) return;
  refreshGameStatus();
  if (state.status.state !== "playing") return;

  // 引擎走子认自己的代次：分析开关的启停不会误伤这一步。
  const generation = ++state.moveGeneration;
  state.engineThinking = true;
  state.analysisActive = false;
  state.analysisStarting = false;
  setHintMove(null);
  updateAnalysisControls();
  const persona = effectivePersona();
  const effectiveThinkMs = resolvePersonaThinkMs({
    persona,
    requestedThinkMs: state.thinkTimeMs,
  });
  setEngineState(
    "thinking",
    `${persona.name} · 最长 ${formatThinkTime(effectiveThinkMs)}`,
  );

  try {
    const position = enginePositionForState({
      freePlay: state.freePlay,
      board: state.board,
      turn: state.turn,
      playStartFen: state.playStartFen,
      moveHistory: state.moveHistory,
    });
    const result = await api("/api/engine/go", {
      startFen: position.startFen,
      moves: position.moves,
      maxThinkMs: effectiveThinkMs,
      personaId: state.personaId,
      personaIntent: state.personaIntent,
      personaTraits: activePersonaTraits(),
      personaController: activePersonaController(),
      // 自由难度模式：把当前档位的自定义参数一并下发，服务端会打上
      // freeThinkTime 标记，思考时间不再被内置人格的建议时间截断。
      personaOverrides: personaRequestOverrides(),
      categoryHistory: state.personaHistory,
    });
    // ⚠️ 必须与上面取代次时用的**同一个**计数器（moveGeneration）。
    // 曾经只改了取代次那一行而漏改这里，结果引擎每一步都在守卫处被静默丢弃，
    // 表现就是"机器永远不走棋"。已由 tests/engine-move-guard.test.js 钉住。
    if (generation !== state.moveGeneration) return;
    if (state.userPaused && !force) {
      state.pendingEngineMove = true;
      return;
    }
    if (!result.bestmove || result.bestmove === "0000") {
      showToast("当前局面没有可走着法。");
      return;
    }
    const move = uciToMove(result.bestmove);
    if (result.persona) {
      state.personaDecision = result.persona;
      state.personaHistory.push(result.persona.category);
      updatePersonaDisplay();
    }
    state.engineThinking = false;
    updateAnalysisControls();
    await commitMove(move, "engine");
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    if (generation === state.moveGeneration) {
      state.engineThinking = false;
      updateAnalysisControls();
      setEngineState("ready", "在线");
    }
  }
}

async function api(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `操作失败：${response.status}`);
  }
  return payload;
}

async function initializeEngine(overrides = {}) {
  const logicalProcessors = state.system?.logicalProcessors ?? 14;
  const defaultHash = recommendedHash(state.system);
  const threads = Number(overrides.threads ?? elements.threadsInput.value ?? logicalProcessors);
  const hash = Number(overrides.hash ?? elements.hashInput.value ?? defaultHash);
  const multiPV = Number(overrides.multiPV ?? elements.multiPvInput.value ?? 1);

  elements.threadsInput.value = String(Math.max(1, Math.min(64, threads)));
  elements.hashInput.value = String(Math.max(16, Math.min(65536, hash)));
  elements.multiPvInput.value = String(Math.max(1, Math.min(16, multiPV)));

  setEngineState("starting", "正在载入神经网络");
  const result = await api("/api/engine/init", {
    threads: Number(elements.threadsInput.value),
    hash: Number(elements.hashInput.value),
    multiPV: Number(elements.multiPvInput.value),
    moveOverhead: 30,
  });
  state.engineReady = true;
  setEngineState("ready", "在线");
  if (result.hashFallback) {
    elements.hashInput.value = String(result.options.Hash);
    elements.hashInput.dataset.userEdited = "true";
    showToast(
      `内存不足，哈希表已自动从 ${result.hashFallback.from} MB 调整为 ${result.hashFallback.to} MB。`,
      "info",
    );
  }
  if (result.system) updateSystemSummary(result.system);
}

function recommendedHash(system = {}) {
  const freeMemoryGB = Number.isFinite(system.freeMemoryGB)
    ? system.freeMemoryGB
    : system.totalMemoryGB ?? 16;
  const byFreeMemory =
    Math.floor((freeMemoryGB * 1024) / 4 / 128) * 128;
  return Math.max(512, Math.min(2048, byFreeMemory));
}

function updateSystemSummary(system) {
  state.system = system;
  elements.cpuSummary.textContent = `${system.cpuModel} · ${system.logicalProcessors} 线程 · ${system.totalMemoryGB} GB · 可用 ${system.freeMemoryGB} GB`;
  const lanAddresses = Array.isArray(system.lanAddresses)
    ? system.lanAddresses.filter(Boolean)
    : [];
  elements.lanAccessHint.textContent = lanAddresses.length
    ? `跨设备语音已就绪。同一局域网可打开：${lanAddresses.join(" 或 ")}`
    : `跨设备语音仅限本机。当前地址：${system.localUrl || "http://127.0.0.1/"}；若需其它设备访问，请确认防火墙允许并重新启动。`;
  if (!elements.threadsInput.dataset.userEdited) {
    elements.threadsInput.value = String(Math.min(64, system.logicalProcessors));
  }
  if (!elements.hashInput.dataset.userEdited) {
    elements.hashInput.value = String(recommendedHash(system));
  }
}

function updateAnalysis(info) {
  if (
    state.mode !== "play" ||
    (!state.analysisActive &&
      !state.analysisStarting &&
      !state.engineThinking)
  ) {
    return;
  }
  // 预判搜索发生在"玩家走完预判着法后的子局面"，评分视角与当前主局面相反。
  // 它只用来刷新预判状态与深度，绝不能污染主分析面板。
  if (info.searchMode === "ponder") {
    if (Number.isFinite(info.depth)) {
      state.ponderDepth = Math.max(state.ponderDepth, info.depth);
    }
    renderForecastChip();
    return;
  }
  if (info.multipv && info.multipv !== 1) return;
  if (Number.isFinite(info.depth)) {
    elements.depthValue.textContent = `${info.depth}${info.seldepth ? `/${info.seldepth}` : ""}`;
  }
  if (info.score) elements.scoreValue.textContent = formatScore(info.score);
  if (Number.isFinite(info.nps)) elements.npsValue.textContent = formatNumber(info.nps);
  if (Number.isFinite(info.hashfull)) {
    elements.hashValue.textContent = `${(info.hashfull / 10).toFixed(1)}%`;
  }
  if (info.pv?.length) {
    elements.pvText.textContent = formatPv(info.pv);
    if (hintCanDisplay()) {
      setHintMove(selectHintMove(state.board, state.turn, info.pv));
    }
  }
  schedulePositionCommentary();
}

function formatPv(pv) {
  let board = cloneBoard(state.board);
  let side = state.turn;
  const parts = [];
  for (const uci of pv.slice(0, 10)) {
    try {
      const move = uciToMove(uci);
      const piece = board[move.from[0]][move.from[1]];
      if (piece === "." || pieceSide(piece) !== side) break;
      parts.push(`${pieceName(piece)} ${uci.slice(0, 2)}-${uci.slice(2)}`);
      board = applyMove(board, move);
      side = opposite(side);
    } catch {
      break;
    }
  }
  return parts.length ? parts.join("  ") : "等待引擎分析";
}

async function switchMode(mode, { resumeAnalysis = true } = {}) {
  const modeChanged = state.mode !== mode;
  // 从复盘/训练返回对局时，只有进入前持续思考确实在运行才自动恢复；
  // 其它模式切换沿用原来的恢复规则。
  let restoreContinuousAnalysis = true;

  if (mode === "review") {
    if (modeChanged) {
      state.reviewOriginalMode = state.mode;
      state.reviewOriginalGameStarted = state.gameStarted;
      state.reviewOriginalContinuous = Boolean(
        state.analysisActive || state.analysisStarting,
      );
      state.reviewBoardSnapshot = {
        board: cloneBoard(state.board),
        turn: state.turn,
        playStartFen: state.playStartFen,
        moveHistory: state.moveHistory.slice(),
        history: state.history.slice(),
        personaHistory: state.personaHistory.slice(),
        personaDecision: state.personaDecision,
        lastMove: state.lastMove,
        lastMoveText: state.lastMoveText,
      };
      if (state.trainingActive) exitTraining({ silent: true });
      await haltEngineSearch({ detail: "复盘模式已暂停持续分析" });
      state.gameStarted = false;
      state.analysisPaused = false;
      setHintMove(null);
    }
  } else {
    if (state.mode === "review") {
      if (state.reviewRunning) await cancelReview({ silent: true });
      if (state.trainingActive) exitTraining({ silent: true });
      restoreContinuousAnalysis = state.reviewOriginalContinuous;
      state.reviewArrows = [];
      const restoreGame = mode === "play" && state.reviewOriginalGameStarted;
      state.gameStarted = restoreGame;
      if (restoreGame && state.reviewBoardSnapshot) {
        const snapshot = state.reviewBoardSnapshot;
        state.board = cloneBoard(snapshot.board);
        state.turn = snapshot.turn;
        state.playStartFen = snapshot.playStartFen;
        state.moveHistory = snapshot.moveHistory.slice();
        state.history = snapshot.history.slice();
        state.personaHistory = snapshot.personaHistory.slice();
        state.personaDecision = snapshot.personaDecision;
        state.lastMove = snapshot.lastMove;
        state.lastMoveText = snapshot.lastMoveText;
        state.selected = null;
        state.legalMoves = [];
      }
    } else if (mode !== "play") {
      state.gameStarted = false;
    }
    if (mode !== "play" || !resumeAnalysis) {
      await haltEngineSearch({
        detail: mode === "play" ? "准备开始新对局" : "编辑模式已暂停分析",
      });
    }
    if (mode !== "play") setHintMove(null);
  }

  state.mode = mode;
  const isPlay = mode === "play";
  const isEdit = mode === "edit";
  const isReview = mode === "review";
  elements.playTab.classList.toggle("active", isPlay);
  elements.editTab.classList.toggle("active", isEdit);
  elements.reviewTab.classList.toggle("active", isReview);
  elements.playTab.setAttribute("aria-selected", String(isPlay));
  elements.editTab.setAttribute("aria-selected", String(isEdit));
  elements.reviewTab.setAttribute("aria-selected", String(isReview));
  elements.playPanel.hidden = !isPlay;
  elements.editPanel.hidden = !isEdit;
  elements.reviewPanel.hidden = !isReview;
  if (isEdit) {
    elements.editTurnSelect.value = state.turn;
  }
  if (isReview) {
    elements.reviewStateText.textContent = state.reviewGame
      ? `${state.reviewGame.label || "已载入对局"} · ${state.reviewGame.moves.length} 手`
      : "未载入对局";
    renderReviewTree();
  }
  updateReviewControls();
  renderAll();

  if (isPlay && resumeAnalysis && modeChanged) {
    if (restoreContinuousAnalysis) {
      await resumeCurrentPosition();
    } else if (state.gameStarted && state.turn !== state.humanSide) {
      // 持续分析本来就没开，但轮到引擎行棋时仍要把这一手补上。
      await requestEngineMove();
    }
  }
}

async function startGame() {
  const validation = validatePosition(state.board, state.turn);
  if (!validation.ok) {
    showToast(validation.message, "error");
    return;
  }
  state.humanSide = elements.humanSideSelect.value === "b" ? BLACK : RED;
  await switchMode("play", { resumeAnalysis: false });
  state.gameStarted = true;
  resetCurrentPosition();
  try {
    if (state.engineReady) await api("/api/engine/new", {});
  } catch {
    // A new game is a best-effort reset.
  }
  renderAll();
  await resumeCurrentPosition();
}

async function resetStandardOpening() {
  await haltEngineSearch({ detail: "正在恢复标准开局" });
  advanceCommentaryPosition();
  const start = parseFen(START_FEN);
  state.board = cloneBoard(start.board);
  state.turn = start.turn;
  state.playStartFen = START_FEN;
  state.moveHistory = [];
  state.history = [];
  state.lastMove = null;
  state.lastMoveText = "尚未走棋";
  state.selected = null;
  state.legalMoves = [];
  state.analysisPaused = false;
  state.gameStarted = false;
  state.engineGeneration += 1;
  state.moveGeneration += 1;
  setHintMove(null);
  await switchMode("play", { resumeAnalysis: false });
  renderAll();

  if (state.engineReady) {
    try {
      await api("/api/engine/new", {});
    } catch {
      // The board reset is still useful if the engine reset fails.
    }
  }

  if (state.engineReady) setEngineState("ready", "等待开始对局");
  showToast("已恢复标准开局，点击“开始对局”后继续。");
}

async function undoMove() {
  if (!state.history.length) {
    showToast("当前没有可悔的棋步。");
    return;
  }
  await haltEngineSearch({ detail: "已悔棋" });
  advanceCommentaryPosition();
  const previous = state.history.pop();
  state.board = previous.board;
  state.turn = previous.turn;
  state.playStartFen = previous.playStartFen;
  state.freePlayStartFen = previous.freePlayStartFen ?? "";
  state.moveHistory = previous.moveHistory;
  state.freeMoves = Array.isArray(previous.freeMoves)
    ? previous.freeMoves.map((entry) => ({ ...entry }))
    : [];
  state.moveEvaluations = Array.isArray(previous.moveEvaluations)
    ? previous.moveEvaluations.slice()
    : [];
  state.personaHistory = previous.personaHistory ?? [];
  state.personaDecision = previous.personaDecision ?? null;
  state.lastMove = previous.lastMove;
  state.lastMoveText = previous.lastMoveText;
  state.selected = null;
  state.legalMoves = [];
  state.evaluationGeneration = (state.evaluationGeneration ?? 0) + 1;
  setHintMove(null);
  renderLastMoveEvaluation();
  renderAll();
  await resumeCurrentPosition();
}

async function loadFen(fen) {
  try {
    const parsed = parseFen(fen);
    await haltEngineSearch({ detail: "局面已载入" });
    state.board = cloneBoard(parsed.board);
    state.turn = parsed.turn;
    state.gameStarted = false;
    resetCurrentPosition();
    elements.editTurnSelect.value = state.turn;
    renderAll();
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
    return false;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("残局代码已复制。");
  } catch {
    elements.fenInput.value = text;
    elements.fenInput.select();
    document.execCommand("copy");
    showToast("残局代码已复制。");
  }
}

function setVisionStatus(message, type = "") {
  elements.visionStatus.textContent = message;
  elements.visionStatus.className = `vision-status${
    type === "error" ? " error" : type === "success" ? " success" : ""
  }`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("无法读取所选图片。"));
    reader.readAsDataURL(file);
  });
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析所选图片，请换一张图片。"));
    image.src = dataUrl;
  });
}

async function prepareVisionImage(file) {
  if (!file) throw new Error("请选择一张棋盘图片。");
  if (!file.type.startsWith("image/")) {
    throw new Error("所选文件不是图片。");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("原始图片超过 20 MB，请先压缩或裁剪。");
  }

  const source = await fileToDataUrl(file);
  const image = await imageFromDataUrl(source);
  const naturalEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const targetEdge = Math.min(2000, Math.max(1600, naturalEdge));
  const scale = Math.min(2.5, targetEdge / naturalEdge);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法处理这张图片。");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.filter = "contrast(1.08) saturate(1.06)";
  context.drawImage(image, 0, 0, width, height);
  context.filter = "none";
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    dataUrl,
    width,
    height,
    displayUrl: source,
  };
}

async function selectVisionImage(file) {
  if (!file) return;
  setVisionStatus("正在处理图片...");
  state.visionImageDataUrl = "";
  state.visionImageName = file.name;
  elements.recognizeVisionBtn.disabled = true;
  try {
    const image = await prepareVisionImage(file);
    state.visionImageDataUrl = image.dataUrl;
    elements.visionPreview.src = image.displayUrl;
    elements.visionPreviewWrap.hidden = false;
    elements.recognizeVisionBtn.disabled = false;
    const sizeMB = image.dataUrl.length / 1024 / 1024;
    setVisionStatus(
      `已准备 ${image.width} × ${image.height} 图片，上传数据约 ${sizeMB.toFixed(1)} MB。`,
      "success",
    );
  } catch (error) {
    state.visionImageDataUrl = "";
    elements.visionPreviewWrap.hidden = true;
    elements.visionPreview.removeAttribute("src");
    setVisionStatus(
      error instanceof Error ? error.message : String(error),
      "error",
    );
  } finally {
    elements.visionImageInput.value = "";
  }
}

async function recognizeVisionPosition() {
  const apiKey = elements.deepseekApiKey.value.trim();
  if (!apiKey) {
    setVisionStatus(
      "请先在“设置 · AI 助手与 API 密钥”中填写 API Key。",
      "error",
    );
    setSettingsOpen(true);
    elements.deepseekApiKey.focus();
    showToast("请先填写 DeepSeek API Key。", "error");
    return;
  }
  if (!state.visionImageDataUrl || state.visionRecognizing) return;

  state.visionRecognizing = true;
  elements.recognizeVisionBtn.disabled = true;
  elements.recognizeVisionBtn.textContent = "正在识别...";
  const refine = elements.visionRefine.checked;
  setVisionStatus(
    refine
      ? "正在逐行识别棋盘并进行智能复核；如果两次结果冲突，会自动追加仲裁。"
      : "正在逐格识别棋盘，通常需要几秒到几十秒。",
  );
  try {
    const result = await api("/api/commentary/vision", {
      apiKey,
      model:
        elements.deepseekVisionModel.value.trim() || "deepseek-flash",
      imageDataUrl: state.visionImageDataUrl,
      refine,
    });
    const matrix = normalizeVisionMatrix(result.board);
    const assessment = assessVisionMatrix(matrix);
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    const note = result.notes ? ` ${result.notes}` : "";
    const passes = Number(result.passes) || 1;
    const passText =
      passes >= 3
        ? "已完成三次仲裁识别，"
        : passes === 2
          ? "已完成两轮交叉复核，"
          : "";
    openVisionReview({
      matrix,
      conflicts,
      flagged: assessment.flagged,
      notes: `${passText}请核对下方 10×9 棋子矩阵。${note}`,
    });
    setVisionStatus(
      `识别完成，${passText}请在核对面板确认后再载入。${note}`,
      "success",
    );
    showToast("识别完成，请核对棋盘后载入。");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setVisionStatus(message, "error");
    showToast(message, "error");
  } finally {
    state.visionRecognizing = false;
    elements.recognizeVisionBtn.disabled = !state.visionImageDataUrl;
    elements.recognizeVisionBtn.textContent = "识别并载入";
  }
}

/* ---------------------------- 识图人工纠错闭环 ---------------------------- */

function closeVisionReview() {
  elements.visionReviewModal.hidden = true;
  state.visionReview = null;
}

function visionCellKey(row, col) {
  return `${row}:${col}`;
}

function openVisionReview({ matrix, conflicts = [], flagged = [], notes = "" }) {
  const rows = normalizeVisionMatrix(matrix);
  const conflictKeys = new Set();
  for (const entry of conflicts) {
    if (Number.isInteger(entry?.row) && Number.isInteger(entry?.col)) {
      conflictKeys.add(visionCellKey(entry.row, entry.col));
    }
  }
  const flagMap = new Map();
  for (const flag of flagged) {
    if (Number.isInteger(flag?.row) && Number.isInteger(flag?.col)) {
      flagMap.set(visionCellKey(flag.row, flag.col), flag.reason || "识别疑点");
    }
  }
  state.visionReview = {
    matrix: rows.map((row) => row.slice()),
    conflictKeys,
    flagMap,
    correctedKeys: new Set(),
    notes: typeof notes === "string" ? notes : "",
  };
  elements.visionReviewTurn.value = state.turn === BLACK ? "b" : "w";
  renderVisionReview();
  elements.visionReviewModal.hidden = false;
}

function applyVisionCellClasses(cell, row, col) {
  const review = state.visionReview;
  if (!review) return;
  const key = visionCellKey(row, col);
  const piece = review.matrix[row][col];
  cell.classList.remove("black", "empty", "conflict", "corrected");
  if (piece === ".") {
    cell.classList.add("empty");
  } else if (piece === piece.toLowerCase()) {
    cell.classList.add("black");
  }
  if (review.conflictKeys.has(key)) cell.classList.add("conflict");
  if (review.correctedKeys.has(key)) cell.classList.add("corrected");
  const reason = review.flagMap.get(key);
  if (reason) cell.title = reason;
  else cell.removeAttribute("title");
}

function renderVisionReviewMessages() {
  const review = state.visionReview;
  if (!review) return;
  const assessment = assessVisionMatrix(review.matrix);
  const container = elements.visionReviewMessages;
  container.innerHTML = "";
  const add = (text, ok = false) => {
    const paragraph = document.createElement("p");
    if (ok) paragraph.classList.add("ok");
    paragraph.textContent = text;
    container.append(paragraph);
  };
  if (review.notes) add(review.notes, true);
  const reasons = new Set(review.flagMap.values());
  for (const reason of reasons) add(reason);
  for (const message of assessment.messages) add(message);
  if (!reasons.size && !assessment.messages.length && !review.conflictKeys.size) {
    add("未发现明显异常，确认后即可载入。", true);
  }
}

function updateVisionReviewSummary() {
  const review = state.visionReview;
  if (!review) return;
  const assessment = assessVisionMatrix(review.matrix);
  elements.visionReviewSummary.textContent = `红方 ${assessment.counts.red} 子 · 黑方 ${assessment.counts.black} 子 · 疑点 ${review.flagMap.size + review.conflictKeys.size}`;
  renderVisionReviewMessages();
}

function renderVisionReview() {
  const review = state.visionReview;
  if (!review) return;
  const board = elements.visionReviewBoard;
  board.innerHTML = "";
  const optionValues = new Set(VISION_REVIEW_PIECES.map((item) => item.value));
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const cell = document.createElement("select");
      cell.className = "vision-review-cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("aria-label", `第 ${row + 1} 行第 ${col + 1} 列`);
      for (const option of VISION_REVIEW_PIECES) {
        const item = document.createElement("option");
        item.value = option.value;
        item.textContent = option.value === "." ? "空" : option.label;
        cell.append(item);
      }
      const piece = review.matrix[row][col];
      cell.value = optionValues.has(piece) ? piece : ".";
      applyVisionCellClasses(cell, row, col);
      board.append(cell);
    }
  }
  updateVisionReviewSummary();
}

function handleVisionReviewChange(event) {
  const cell = event.target.closest("[data-row][data-col]");
  if (!cell || !state.visionReview) return;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return;
  state.visionReview.matrix[row][col] = cell.value;
  state.visionReview.correctedKeys.add(visionCellKey(row, col));
  applyVisionCellClasses(cell, row, col);
  updateVisionReviewSummary();
}

async function confirmVisionReview() {
  const review = state.visionReview;
  if (!review) return;
  const turn = elements.visionReviewTurn.value === "b" ? BLACK : RED;
  let fen = "";
  try {
    fen = visionMatrixToFen(review.matrix, turn);
    parseFen(fen);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  closeVisionReview();
  const loaded = await loadFen(fen);
  if (loaded) {
    setVisionStatus("已载入人工核对后的局面。", "success");
    showToast("识图局面已载入。");
  }
}

function gameRecordFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  return `中国象棋棋谱-${stamp}.txt`;
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function saveGameRecord() {
  try {
    if (state.freePlay) {
      if (!state.freeMoves.length) {
        showToast("当前还没有走棋，暂时没有可保存的棋谱。", "error");
        return;
      }
      downloadTextFile(
        serializeFreePlayRecord(),
        gameRecordFilename(),
      );
      showToast(`自由行棋棋谱已保存为 TXT，共 ${state.freeMoves.length} 步。`);
      return;
    }
    if (!state.moveHistory.length) {
      showToast("当前还没有走棋，暂时没有可保存的棋谱。", "error");
      return;
    }
    const record = createGameRecord({
      initialFen: state.playStartFen,
      humanSide: state.humanSide,
      moves: state.moveHistory,
    });
    downloadTextFile(serializeGameRecord(record), gameRecordFilename());
    showToast(`棋谱已保存为 TXT，共 ${record.moves.length} 步。`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

/**
 * 自由行棋允许同一方连走，标准棋谱校验会拒绝这种序列，
 * 因此这里单独输出一份带传统记谱的 TXT。
 */
function serializeFreePlayRecord() {
  const lines = [
    "中国象棋对局棋谱",
    "格式: xiangqi-studio-freeplay",
    "版本: 1",
    `保存时间: ${new Date().toISOString()}`,
    "对局模式: 自由行棋",
    `起始局面: ${state.freePlayStartFen || boardToFen(state.board, state.turn)}`,
    `最终局面: ${boardToFen(state.board, state.turn)}`,
    `结果: ${state.status.state}`,
    `结果说明: ${state.status.reason || ""}`,
    "",
    "[传统记谱]",
  ];
  state.freeMoves.forEach((entry, index) => {
    const sideText = entry.side === RED ? "红方" : "黑方";
    lines.push(`${index + 1}. ${sideText} ${entry.notation} (${entry.uci})`);
  });
  lines.push(
    "",
    "[说明]",
    "自由行棋模式允许同一方连续走棋，记谱按实际落子顺序排列。",
    "传统记谱用于阅读，括号内坐标用于逐步精确还原。",
  );
  return `${lines.join("\r\n")}\r\n`;
}

function buildImportedHistory(record) {
  let board = cloneBoard(record.initialBoard);
  let turn = record.initialTurn;
  let lastMove = null;
  let lastMoveText = "尚未走棋";
  const history = [];

  for (let index = 0; index < record.moves.length; index += 1) {
    history.push({
      board: cloneBoard(board),
      turn,
      playStartFen: record.initialFen,
      moveHistory: record.moves.slice(0, index),
      lastMove: lastMove
        ? { from: [...lastMove.from], to: [...lastMove.to] }
        : null,
      lastMoveText,
    });

    const move = uciToMove(record.moves[index]);
    const description =
      record.moveRecords[index]?.notation ||
      record.moveRecords[index]?.description ||
      "";
    board = applyMove(board, move);
    turn = opposite(turn);
    lastMove = move;
    lastMoveText = description ? `棋谱 · ${description}` : "棋谱走法";
  }

  return {
    board,
    turn,
    history,
    lastMove,
    lastMoveText,
  };
}

async function importGameRecordFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast("棋谱文件过大，无法导入。", "error");
    return;
  }

  try {
    const record = parseGameRecord(await file.text());
    await haltEngineSearch({ detail: "正在导入棋谱" });
    advanceCommentaryPosition();
    if (record.freePlay) {
      const imported = buildImportedFreePlayHistory(record);
      state.freePlay = true;
      applyFreePlayUi();
      state.board = imported.board;
      state.turn = imported.turn;
      state.playStartFen = record.initialFen;
      state.freePlayStartFen = record.initialFen;
      state.freeMoves = imported.freeMoves;
      state.moveHistory = record.moves.slice();
      state.history = imported.history;
      state.lastMove = imported.lastMove;
      state.lastMoveText = imported.lastMoveText;
      state.selected = null;
      state.legalMoves = [];
      state.analysisPaused = false;
      state.gameStarted = false;
      await switchMode("play", { resumeAnalysis: false });
      renderAll();
      if (state.engineReady) {
        try {
          await api("/api/engine/new", {});
        } catch {
          // 引擎重置失败不影响棋谱查看。
        }
      }
      showToast(
        `自由行棋棋谱已导入，共 ${record.moves.length} 步；可继续自由摆子。${
          record.resultMismatch ? "旧版胜负字段已按终局校正。" : ""
        }`,
      );
      return;
    }
    const imported = buildImportedHistory(record);
    state.board = imported.board;
    state.turn = imported.turn;
    state.playStartFen = record.initialFen;
    state.moveHistory = record.moves.slice();
    state.history = imported.history;
    state.lastMove = imported.lastMove;
    state.lastMoveText = imported.lastMoveText;
    state.selected = null;
    state.legalMoves = [];
    state.analysisPaused = false;
    state.gameStarted = false;
    state.humanSide = record.humanSide;
    elements.humanSideSelect.value =
      state.humanSide === RED ? RED : BLACK;
    await switchMode("play", { resumeAnalysis: false });
    renderAll();

    if (state.engineReady) {
      try {
        await api("/api/engine/new", {});
      } catch {
        // The imported game can still be viewed if the engine reset fails.
      }
    }
    showToast(
      `棋谱已导入，共 ${record.moves.length} 步；点击“开始对局”后继续。${
        record.resultMismatch ? "旧版胜负字段已按终局校正。" : ""
      }`,
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    elements.recordFileInput.value = "";
  }
}

/**
 * 自由行棋棋谱：行棋方不交替，按记录中的行棋方逐步还原，
 * 并重建自由行棋的走子列表，方便导入后继续摆子。
 */
function buildImportedFreePlayHistory(record) {
  let board = cloneBoard(record.initialBoard);
  let turn = record.initialTurn;
  let lastMove = null;
  let lastMoveText = "尚未走棋";
  const freeMoves = [];
  const history = [];

  for (let index = 0; index < record.moves.length; index += 1) {
    const uci = record.moves[index];
    const move = uciToMove(uci);
    // 自由行棋不要求双方轮转：行棋方以棋谱记录为准，
    // 缺失时才退回棋子颜色，再退回上一步推导出的行棋方。
    const moveSide =
      record.moveRecords[index]?.side ??
      pieceSide(board[move.from[0]][move.from[1]]) ??
      turn;
    const description =
      record.moveRecords[index]?.notation ||
      record.moveRecords[index]?.description ||
      "";
    const fenBefore = boardToFen(board, moveSide);

    history.push({
      board: cloneBoard(board),
      turn: moveSide,
      playStartFen: record.initialFen,
      freePlayStartFen: record.initialFen,
      moveHistory: record.moves.slice(0, index),
      freeMoves: freeMoves.map((entry) => ({ ...entry })),
      moveEvaluations: [],
      personaHistory: [],
      personaDecision: null,
      lastMove: lastMove
        ? { from: [...lastMove.from], to: [...lastMove.to] }
        : null,
      lastMoveText,
    });

    board = applyMove(board, move);
    freeMoves.push({
      side: moveSide,
      uci,
      notation: description,
      fenBefore,
      fenAfter: boardToFen(board, opposite(moveSide)),
    });
    turn = opposite(moveSide);
    lastMove = move;
    lastMoveText = description ? `棋谱 · ${description}` : "棋谱走法";
  }

  return {
    board,
    // 自由行棋的“下一手行棋方”由棋谱头部记录，解析后原样恢复。
    turn: record.turn ?? turn,
    history,
    lastMove,
    lastMoveText,
    freeMoves,
  };
}

function applyEndgamePresets() {
  elements.endgamePresets.innerHTML = "";
  for (const preset of ENDGAME_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "endgame-button";
    button.innerHTML = `${preset.name}<span>${preset.detail}</span>`;
    button.addEventListener("click", async () => {
      if (await loadFen(preset.fen)) showToast(`已载入：${preset.name}`);
    });
    elements.endgamePresets.append(button);
  }
}

/* ------------------------------ 复盘与专项训练 ------------------------------ */

const REVIEW_ACTUAL_COLOR = "#d64545";
const REVIEW_BEST_COLOR = "#2f9e44";

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function shortHash(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function reviewGameFilename(extension = "json") {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  return `中国象棋对局-${stamp}.${extension}`;
}

function setReviewProgress(done, total, text) {
  const safeTotal = Math.max(0, Math.trunc(Number(total) || 0));
  const safeDone = Math.max(0, Math.min(Math.trunc(Number(done) || 0), safeTotal));
  const percent = safeTotal ? Math.round((safeDone / safeTotal) * 100) : 0;
  elements.reviewProgressBar.max = Math.max(1, safeTotal);
  elements.reviewProgressBar.value = safeDone;
  elements.reviewProgressPercent.textContent = `${percent}%`;
  elements.reviewProgressText.textContent = text;
}

function updateReviewSummary() {
  const summary = summarizeReview(state.reviewResults);
  elements.reviewGoodCount.textContent = String(summary.good);
  elements.reviewInaccuracyCount.textContent = String(summary.inaccuracy);
  elements.reviewBlunderCount.textContent = String(summary.blunder);
}

function updateReviewControls() {
  const busy = state.reviewRunning;
  elements.startReviewBtn.disabled =
    busy || !state.reviewGame || !state.engineReady;
  elements.cancelReviewBtn.disabled = !busy;
  elements.importReviewBtn.disabled = busy;
  elements.fixtureReviewBtn.disabled = busy;
  elements.exportReviewBtn.disabled =
    busy ||
    !((state.reviewGame && state.reviewGame.moves.length) ||
      state.moveHistory.length);
  elements.endTrainingBtn.disabled = !state.trainingActive;

  for (const key of REVIEW_LOCKED_CONTROL_KEYS) {
    const control = elements[key];
    if (!control) continue;
    control.disabled = busy || reviewControlBaseline.get(key) === true;
  }

  const storage = getStorage();
  const pending = loadMistakeBook(storage).filter(
    (entry) => entry.status === MISTAKE_STATUS.UNKNOWN,
  ).length;
  elements.startTrainingBtn.disabled = busy || state.trainingActive || pending === 0;
}

function updateMistakeBookUI() {
  const storage = getStorage();
  const list = loadMistakeBook(storage);
  const pending = list.filter(
    (entry) => entry.status === MISTAKE_STATUS.UNKNOWN,
  ).length;
  elements.mistakeBookSummary.textContent = `${list.length} 题 · 未掌握 ${pending}`;
  const stats = loadTrainingStats(storage);
  elements.trainingAttempts.textContent = String(stats.attempts);
  elements.trainingAccuracy.textContent = `${Math.round(
    trainingAccuracy(stats) * 100,
  )}%`;
  elements.trainingMasteredToday.textContent = String(masteredToday(stats));
  updateReviewControls();
}

function exportReviewGame() {
  try {
    const startFen = state.reviewGame?.startFen || state.playStartFen;
    const moves = state.reviewGame?.moves?.length
      ? state.reviewGame.moves
      : state.moveHistory;
    if (!moves.length) {
      showToast("当前还没有可导出的走法。", "error");
      return;
    }
    const payload = createGameExport({ startFen, moves });
    downloadTextFile(serializeGameExport(payload), reviewGameFilename("json"));
    showToast(`对局已导出，共 ${payload.moves.length} 手。`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

function applyReviewGame(raw, { gameId = "", label = "" } = {}) {
  const parsed = parseGameTransfer(raw);
  if (!parsed.moves.length) {
    throw new Error("这盘对局里没有可复盘的走法。");
  }
  const replay = replayGame({ startFen: parsed.startFen, moves: parsed.moves });
  state.reviewGame = {
    gameId:
      gameId || `game-${shortHash(`${parsed.startFen}|${parsed.moves.join("")}`)}`,
    startFen: parsed.startFen,
    moves: parsed.moves,
    label,
    createdAt: parsed.createdAt || "",
  };
  state.reviewRecords = replay.records;
  state.reviewResults = [];
  state.reviewSelectedPly = 0;
  state.reviewArrows = [];
  state.reviewCancelled = false;
  state.reviewRunning = false;
  elements.reviewDetail.hidden = true;
  elements.reviewDetail.innerHTML = "";
  elements.reviewStateText.textContent = `${label || "已载入对局"} · ${parsed.moves.length} 手`;
  setReviewProgress(0, parsed.moves.length, "等待开始复盘");
  updateReviewSummary();
  renderReviewTree();
  showReviewPly(0);
  updateReviewControls();
}

async function importReviewFile(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    showToast("对局文件过大，无法导入。", "error");
    return;
  }
  try {
    const text = await file.text();
    await switchMode("review");
    applyReviewGame(text, { label: file.name });
    showToast(`已导入对局 ${file.name}。`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    elements.reviewFileInput.value = "";
  }
}

async function loadFixtureReviewGame() {
  if (state.reviewRunning) return;
  try {
    const response = await fetch("/api/review/fixture");
    if (!response.ok) throw new Error("内置测试对局不可用。");
    const raw = await response.json();
    await switchMode("review");
    applyReviewGame(raw, {
      gameId: raw.gameId || "",
      label: "内置测试对局",
    });
    showToast("已载入内置测试对局，可以直接开始复盘。");
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

function reviewAnalyzePosition({ positionFen }) {
  return api("/api/engine/bestmove", {
    startFen: positionFen,
    moves: [],
    movetimeMs: REVIEW_MOVETIME_MS,
  }).then((result) => ({
    bestmove: result.bestmove,
    score: result.score,
    depth: result.depth,
  }));
}

function finalizeReview() {
  if (!state.reviewGame) return;
  const mistakes = extractMistakesFromReview({
    gameId: state.reviewGame.gameId,
    startFen: state.reviewGame.startFen,
    results: state.reviewResults,
  });
  const storage = getStorage();
  if (mistakes.length && storage) {
    const { added } = addMistakes(storage, mistakes);
    showToast(
      added
        ? `复盘完成，新增 ${added} 道错题。`
        : "复盘完成，错题本已是最新。",
    );
  } else if (mistakes.length) {
    showToast(`复盘完成，发现 ${mistakes.length} 处严重漏着。`);
  } else {
    showToast("复盘完成，未发现严重漏着。");
  }
  updateMistakeBookUI();
  const firstBlunder = state.reviewResults.find(
    (item) => item.grade === "blunder",
  );
  showReviewPly(firstBlunder ? firstBlunder.ply : state.reviewGame.moves.length);
}

async function startReviewAnalysis() {
  if (state.reviewRunning) return;
  if (!state.reviewGame) {
    showToast("请先导入或载入一盘对局。", "error");
    return;
  }
  if (!state.engineReady) {
    showToast("棋力引擎仍在准备，请稍候。", "error");
    return;
  }
  if (state.trainingActive) exitTraining({ silent: true });
  if (state.mode !== "review") await switchMode("review");

  state.reviewRunning = true;
  state.reviewCancelled = false;
  state.reviewResults = [];
  state.reviewArrows = [];
  updateReviewSummary();
  renderReviewTree();
  setReviewProgress(0, state.reviewGame.moves.length, "准备分析");
  updateReviewControls();
  setEngineState("thinking", "正在逐手复盘");

  try {
    const outcome = await runReviewAnalysis({
      startFen: state.reviewGame.startFen,
      moves: state.reviewGame.moves,
      movetimeMs: REVIEW_MOVETIME_MS,
      analyze: reviewAnalyzePosition,
      isCancelled: () => state.reviewCancelled,
      onProgress: ({ ply, total, phase }) => {
        setReviewProgress(
          ply - 1,
          total,
          phase === "after"
            ? `评估第 ${ply}/${total} 手走后局面`
            : `寻找第 ${ply}/${total} 手最优着法`,
        );
      },
      onMove: (record) => {
        state.reviewResults.push(record);
        setReviewProgress(
          record.ply,
          state.reviewGame.moves.length,
          `已完成 ${record.ply}/${state.reviewGame.moves.length} 手`,
        );
        updateReviewSummary();
        renderReviewTree();
      },
    });
    if (outcome.cancelled) {
      setReviewProgress(
        outcome.completed,
        outcome.total,
        `已取消，完成 ${outcome.completed}/${outcome.total} 手`,
      );
      showToast("复盘已取消。");
    } else {
      setReviewProgress(outcome.total, outcome.total, "复盘完成");
      finalizeReview();
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.reviewRunning = false;
    updateReviewControls();
    setEngineState("ready", "在线");
  }
}

async function cancelReview({ silent = false } = {}) {
  if (!state.reviewRunning) return;
  state.reviewCancelled = true;
  try {
    await api("/api/engine/stop", {});
  } catch {
    // 引擎可能已经结束搜索。
  }
  const deadline = Date.now() + 6000;
  while (state.reviewRunning && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  if (!silent) showToast("复盘分析已取消。");
}

function renderReviewTree() {
  if (!state.reviewGame) {
    elements.reviewMoveTree.innerHTML =
      '<p class="empty-note">尚未载入对局。</p>';
    return;
  }
  const parts = [
    `<button class="review-node review-node-start${
      state.reviewSelectedPly === 0 ? " active" : ""
    }" type="button" data-ply="0" style="--grade-color:#8a9099">
      <span class="review-node-index">起</span>
      <span class="review-node-side">-</span>
      <span class="review-node-text">起始局面</span>
      <span class="review-node-grade">浏览</span>
    </button>`,
  ];

  state.reviewRecords.forEach((record, index) => {
    const ply = index + 1;
    const result = state.reviewResults.find((item) => item.ply === ply);
    const grade = result?.grade ?? "neutral";
    const label = result ? gradeLabel(grade) : "待分析";
    const color = result ? gradeColor(grade) : "#8a9099";
    const side = result?.side ?? record.side;
    parts.push(
      `<button class="review-node grade-${grade}${
        state.reviewSelectedPly === ply ? " active" : ""
      }" type="button" data-ply="${ply}" style="--grade-color:${color}">
        <span class="review-node-index">${ply}</span>
        <span class="review-node-side">${side === RED ? "红" : "黑"}</span>
        <span class="review-node-text">${record.chinese || record.uci}</span>
        <span class="review-node-grade">${label}</span>
      </button>`,
    );
  });

  elements.reviewMoveTree.innerHTML = parts.join("");
}

function markReviewTreeSelection() {
  for (const node of elements.reviewMoveTree.querySelectorAll("[data-ply]")) {
    node.classList.toggle(
      "active",
      Number(node.dataset.ply) === state.reviewSelectedPly,
    );
  }
}

function showReviewPly(ply) {
  if (!state.reviewGame) return;
  const total = state.reviewGame.moves.length;
  const target = Math.max(0, Math.min(Math.trunc(Number(ply) || 0), total));
  const before =
    target === 0 ? [] : state.reviewGame.moves.slice(0, target - 1);
  const replay = replayGame({ startFen: state.reviewGame.startFen, moves: before });
  state.board = cloneBoard(replay.board);
  state.turn = replay.turn;
  state.selected = null;
  state.legalMoves = [];
  state.lastMove =
    target >= 2 ? uciToMove(state.reviewGame.moves[target - 2]) : null;
  state.lastMoveText =
    target === 0
      ? "复盘起始局面"
      : `第 ${target} 手 · ${state.reviewRecords[target - 1]?.chinese ?? ""}`;
  state.reviewSelectedPly = target;
  state.reviewArrows = [];

  if (target > 0) {
    const result = state.reviewResults.find((item) => item.ply === target);
    const actual = state.reviewGame.moves[target - 1];
    state.reviewArrows.push({
      uci: actual,
      color: REVIEW_ACTUAL_COLOR,
      dashed: false,
      duplicate: false,
    });
    if (result?.bestMove) {
      state.reviewArrows.push({
        uci: result.bestMove,
        color: REVIEW_BEST_COLOR,
        dashed: true,
        duplicate: result.bestMove === actual,
      });
    }
  }

  renderAll();
  renderReviewDetail(target);
  markReviewTreeSelection();
}

function formatReviewScore(score) {
  if (!score) return "-";
  if (score.type === "mate") {
    return `杀 ${score.value > 0 ? "+" : ""}${score.value}`;
  }
  return `${score.value >= 0 ? "+" : ""}${score.value} cp`;
}

function renderReviewDetail(ply) {
  const result = state.reviewResults.find((item) => item.ply === ply);
  if (!result) {
    elements.reviewDetail.hidden = true;
    elements.reviewDetail.innerHTML = "";
    return;
  }
  const color = gradeColor(result.grade);
  elements.reviewDetail.hidden = false;
  elements.reviewDetail.innerHTML = `
    <div class="review-detail-head">
      <span class="review-detail-grade" style="--grade-color:${color}">${gradeLabel(result.grade)}</span>
      <strong>第 ${result.ply} 手 · ${result.side === RED ? "红方" : "黑方"}</strong>
      <span class="review-detail-loss">损失 ${Math.round(result.loss)}</span>
    </div>
    <div class="review-detail-row"><span>实战着法</span><strong class="actual">${result.chinese || result.uci}</strong></div>
    <div class="review-detail-row"><span>引擎最优</span><strong class="best">${result.bestChinese || result.bestMove || "无"}</strong></div>
    <div class="review-detail-row"><span>行棋前评分</span><strong>${formatReviewScore(result.bestScore)}</strong></div>
    <div class="review-detail-row"><span>走后评分</span><strong>${formatReviewScore(result.afterScore)}</strong></div>
  `;
}

function trainingQuestionLabel(question) {
  if (!question) return "等待抽题";
  const side = question.sideToMove === "w" ? "红方" : "黑方";
  const ply = question.ply ? `第 ${question.ply} 手` : "错题";
  return `${ply} · ${side}行棋`;
}

function updateTrainingPanel() {
  elements.trainingQuestion.hidden = !state.trainingActive;
  elements.trainingQuestionText.textContent = state.trainingActive
    ? trainingQuestionLabel(state.trainingQuestion)
    : "等待抽题";
}

function loadTrainingQuestion(question) {
  state.trainingQuestion = question;
  state.trainingSelected = null;
  state.trainingLegalMoves = [];
  state.trainingBusy = false;
  const parsed = parseFen(question.fen);
  state.board = cloneBoard(parsed.board);
  state.turn = parsed.turn;
  state.selected = null;
  state.legalMoves = [];
  state.lastMove = null;
  state.lastMoveText = "专项训练";
  state.reviewArrows = [];
  state.gameStarted = false;
  elements.trainingStatus.textContent = "轮到你了，走出你认为正确的着法。";
  elements.trainingStatus.className = "training-status";
  updateTrainingPanel();
  renderAll();
}

function loadNextTrainingQuestion() {
  const storage = getStorage();
  const question = pickTrainingQuestion(loadMistakeBook(storage));
  if (!question) {
    exitTraining();
    showToast("错题本里已经没有未掌握的题目了。");
    return;
  }
  loadTrainingQuestion(question);
  updateMistakeBookUI();
}

async function startTraining() {
  if (state.trainingActive) return;
  if (state.reviewRunning) {
    showToast("复盘分析进行中，请先取消或等待完成。", "error");
    return;
  }
  const storage = getStorage();
  const question = pickTrainingQuestion(loadMistakeBook(storage));
  if (!question) {
    showToast("错题本里暂无未掌握的题目。", "error");
    return;
  }
  // 先快照当前局面，再切到复盘态。切模式会清空对局进行状态，若顺序反过来，
  // 快照拿到的就不是玩家进入训练前的那盘棋了。
  const snapshot = {
    board: cloneBoard(state.board),
    turn: state.turn,
    playStartFen: state.playStartFen,
    moveHistory: state.moveHistory.slice(),
    history: state.history.slice(),
    personaHistory: state.personaHistory.slice(),
    personaDecision: state.personaDecision,
    lastMove: state.lastMove,
    lastMoveText: state.lastMoveText,
  };
  if (state.mode !== "review") await switchMode("review");
  state.trainingSnapshot = snapshot;
  state.trainingActive = true;
  loadTrainingQuestion(question);
  updateTrainingPanel();
  updateMistakeBookUI();
}

function exitTraining({ silent = false } = {}) {
  if (!state.trainingActive) return;
  state.trainingActive = false;
  state.trainingQuestion = null;
  state.trainingSelected = null;
  state.trainingLegalMoves = [];
  state.trainingBusy = false;
  state.selected = null;
  state.legalMoves = [];
  elements.trainingQuestion.hidden = true;
  elements.trainingStatus.textContent = "轮到你了，走出你认为正确的着法。";
  elements.trainingStatus.className = "training-status";
  if (state.trainingSnapshot) {
    state.board = cloneBoard(state.trainingSnapshot.board);
    state.turn = state.trainingSnapshot.turn;
    state.playStartFen = state.trainingSnapshot.playStartFen;
    state.moveHistory = state.trainingSnapshot.moveHistory.slice();
    state.history = (state.trainingSnapshot.history ?? []).slice();
    state.personaHistory = (
      state.trainingSnapshot.personaHistory ?? []
    ).slice();
    state.personaDecision = state.trainingSnapshot.personaDecision ?? null;
    state.lastMove = state.trainingSnapshot.lastMove;
    state.lastMoveText = state.trainingSnapshot.lastMoveText;
    state.trainingSnapshot = null;
  }
  state.reviewArrows = [];
  updateMistakeBookUI();
  renderAll();
  if (!silent) showToast("已退出错题训练。");
}

function selectTrainingPiece(row, col) {
  state.trainingSelected = [row, col];
  state.selected = [row, col];
  state.trainingLegalMoves = generateLegalMoves(state.board, state.turn).filter(
    (move) => move.from[0] === row && move.from[1] === col,
  );
  state.legalMoves = state.trainingLegalMoves;
  renderBoard();
}

function handleTrainingClick(row, col) {
  if (state.trainingBusy) return;
  const piece = state.board[row][col];
  if (state.trainingSelected) {
    const move = state.trainingLegalMoves.find(
      (candidate) => candidate.to[0] === row && candidate.to[1] === col,
    );
    if (move) {
      void submitTrainingMove(move);
      return;
    }
    if (piece !== "." && pieceSide(piece) === state.turn) {
      selectTrainingPiece(row, col);
      return;
    }
    state.trainingSelected = null;
    state.trainingLegalMoves = [];
    state.selected = null;
    state.legalMoves = [];
    renderBoard();
    return;
  }
  if (piece !== "." && pieceSide(piece) === state.turn) {
    selectTrainingPiece(row, col);
  }
}

async function submitTrainingMove(move) {
  const question = state.trainingQuestion;
  if (!question) return;
  const uci = moveToUci(move);
  state.trainingBusy = true;
  state.trainingSelected = null;
  state.selected = null;
  state.trainingLegalMoves = [];
  state.legalMoves = [];
  renderBoard();

  try {
    const storage = getStorage();
    const outcome = await evaluateTrainingAnswer({
      record: question,
      uci,
      requestAfterScore: async () => {
        const boardAfter = applyMove(cloneBoard(state.board), move);
        const turnAfter = opposite(state.turn);
        const fenAfter = boardToFen(boardAfter, turnAfter);
        const info = await api("/api/engine/bestmove", {
          startFen: fenAfter,
          moves: [],
          movetimeMs: REVIEW_MOVETIME_MS,
        });
        return info?.score ?? null;
      },
    });

    if (outcome.passed) {
      if (storage) markMistakeMastered(storage, question.id);
      if (storage) {
        recordTrainingAttempt(storage, { passed: true, mastered: true });
      }
      elements.trainingStatus.textContent = outcome.engineUsed
        ? "走法接近最优，判定通过，已标记为已掌握。"
        : "正确！已标记为已掌握。";
      elements.trainingStatus.className = "training-status success";
      showToast("训练通过，已标记为已掌握。");
    } else {
      if (storage) recordTrainingAttempt(storage, { passed: false });
      const answer = question.bestMove?.chinese || question.bestMove?.uci || "";
      elements.trainingStatus.textContent = `正解应为：${answer}`;
      elements.trainingStatus.className = "training-status error";
      showToast(`未通过，正解应为：${answer}`, "error");
    }
    updateMistakeBookUI();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.trainingBusy = false;
  }

  if (state.trainingActive) {
    window.setTimeout(() => {
      if (state.trainingActive && !state.trainingBusy) loadNextTrainingQuestion();
    }, 1500);
  }
}

function setupEvents() {
  elements.board.addEventListener("click", handleBoardClick);
  elements.settingsToggleBtn.addEventListener("click", () => {
    setSettingsOpen(!state.settingsOpen);
  });
  elements.focusViewBtn.addEventListener("click", () => {
    toggleFocusView();
  });
  elements.globalFullscreenBtn.addEventListener("click", () => {
    void toggleGlobalFullscreen();
  });
  document.addEventListener("fullscreenchange", applyFullscreenUi);
  window.addEventListener(
    "pointerdown",
    unlockSpeechSynthesis,
    { once: true, passive: true },
  );
  window.addEventListener("keydown", unlockSpeechSynthesis, { once: true });
  elements.freePlayToggleBtn.addEventListener("click", () => {
    void setFreePlayEnabled(!state.freePlay);
  });
  elements.switchTurnBtn.addEventListener("click", () => {
    void switchTurnSide();
  });
  elements.continuousThinkingToggleBtn.addEventListener("click", () => {
    void setContinuousThinkingEnabled(!state.continuousThinkingEnabled);
  });
  elements.thinkModeFocusBtn.addEventListener("click", () => {
    void setEngineThinkMode(ENGINE_THINK_MODES.focus);
  });
  elements.thinkModeDistractedBtn.addEventListener("click", () => {
    void setEngineThinkMode(ENGINE_THINK_MODES.distracted);
  });
  elements.lowPowerToggleBtn.addEventListener("click", () => {
    void setLowPowerMode(!state.lowPowerMode);
  });
  elements.matchModeSelect.addEventListener("change", () => {
    void setMatchMode(elements.matchModeSelect.value);
  });
  elements.coachModeToggleBtn.addEventListener("click", () => {
    void setCoachModeEnabled(!state.coachMode);
  });
  elements.coachManualModeBtn.addEventListener("click", () => {
    setCoachTrigger("manual");
  });
  elements.coachAutoModeBtn.addEventListener("click", () => {
    setCoachTrigger("every-move");
  });
  elements.coachAnalyzeBtn.addEventListener("click", () => {
    void runCoachAnalysis({ scope: "current", auto: false });
  });
  elements.coachAnalyzeLastBtn.addEventListener("click", () => {
    void runCoachAnalysis({ scope: "last", auto: false });
  });
  elements.quipToggleBtn.addEventListener("click", () => {
    setQuipEnabled(!state.quipEnabled);
  });
  elements.visionReviewBoard.addEventListener("change", handleVisionReviewChange);
  elements.visionReviewCloseBtn.addEventListener("click", closeVisionReview);
  elements.visionReviewCancelBtn.addEventListener("click", closeVisionReview);
  elements.visionReviewConfirmBtn.addEventListener("click", () => {
    void confirmVisionReview();
  });
  elements.visionReviewModal.addEventListener("click", (event) => {
    if (event.target === elements.visionReviewModal) closeVisionReview();
  });
  elements.flipBoardBtn.addEventListener("click", () => {
    setBoardFlipped(!state.boardFlipped);
  });
  elements.hintToggleBtn.addEventListener("click", () => {
    void setHintEnabled(!state.hintEnabled);
  });
  elements.playTab.addEventListener("click", () => switchMode("play"));
  elements.editTab.addEventListener("click", () => switchMode("edit"));
  elements.humanSideSelect.addEventListener("change", () => {
    state.humanSide = elements.humanSideSelect.value === "b" ? BLACK : RED;
    elements.humanSideValue.textContent = state.humanSide === RED ? "红方" : "黑方";
    saveAppSettings();
  });
  elements.personaSelect.addEventListener("change", () => {
    state.personaId = getPersona(elements.personaSelect.value).id;
    state.personaController = null;
    state.personaHistory = [];
    state.personaDecision = null;
    savePersonaSettings();
    renderPersonaControllerSettings();
    updatePersonaDisplay();
  });
  elements.personaIntentSelect.addEventListener("change", () => {
    state.personaIntent = elements.personaIntentSelect.value;
    state.personaHistory = [];
    state.personaDecision = null;
    savePersonaSettings();
    updatePersonaDisplay();
  });
  for (const input of [
    elements.personaControllerCycle,
    elements.personaControllerBest,
    elements.personaControllerAvoid,
    elements.personaControllerMinStreak,
    elements.personaControllerMaxAvoid,
    elements.personaControllerShuffle,
  ]) {
    input.addEventListener("change", commitPersonaControllerChange);
  }
  elements.personaTraitList.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-trait-toggle]");
    const weight = event.target.closest("[data-trait-weight]");
    if (toggle) {
      const input = elements.personaTraitList.querySelector(
        `[data-trait-weight="${toggle.dataset.traitToggle}"]`,
      );
      if (input) input.disabled = !toggle.checked;
    } else if (weight) {
      const checkbox = elements.personaTraitList.querySelector(
        `[data-trait-toggle="${weight.dataset.traitWeight}"]`,
      );
      if (checkbox) checkbox.checked = Number(weight.value) > 0;
    } else {
      return;
    }
    commitPersonaTraitChange();
  });
  elements.startGameBtn.addEventListener("click", startGame);
  elements.resetOpeningBtn.addEventListener("click", resetStandardOpening);
  elements.engineMoveBtn.addEventListener("click", () => requestEngineMove(true));
  elements.undoBtn.addEventListener("click", undoMove);
  elements.saveRecordBtn.addEventListener("click", saveGameRecord);
  elements.importRecordBtn.addEventListener("click", () => {
    elements.recordFileInput.click();
  });
  elements.recordFileInput.addEventListener("change", () => {
    void importGameRecordFile(elements.recordFileInput.files?.[0]);
  });
  elements.stopBtn.addEventListener("click", stopEngineSearch);

  elements.reviewTab.addEventListener("click", () => {
    void switchMode("review");
  });
  elements.exportReviewBtn.addEventListener("click", exportReviewGame);
  elements.importReviewBtn.addEventListener("click", () => {
    elements.reviewFileInput.click();
  });
  elements.reviewFileInput.addEventListener("change", () => {
    void importReviewFile(elements.reviewFileInput.files?.[0]);
  });
  elements.fixtureReviewBtn.addEventListener("click", () => {
    void loadFixtureReviewGame();
  });
  elements.startReviewBtn.addEventListener("click", () => {
    void startReviewAnalysis();
  });
  elements.cancelReviewBtn.addEventListener("click", () => {
    void cancelReview();
  });
  elements.reviewMoveTree.addEventListener("click", (event) => {
    const node = event.target.closest("[data-ply]");
    if (!node) return;
    showReviewPly(Number(node.dataset.ply));
  });
  elements.startTrainingBtn.addEventListener("click", () => {
    void startTraining();
  });
  elements.endTrainingBtn.addEventListener("click", () => exitTraining());

  elements.thinkTimeRange.addEventListener("input", () => {
    setThinkTime(elements.thinkTimeRange.value);
  });
  // 毫秒输入框改成"确认后提交"：逐字符写 storage 既没必要，也会在用户
  // 打字过程中把中间值（比如 1→1800000 的 "1"）当成最终配置下发引擎。
  elements.thinkTimeInput.addEventListener("change", () => {
    setThinkTime(elements.thinkTimeInput.value);
  });
  elements.thinkTimeInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setThinkTime(elements.thinkTimeInput.value);
    elements.thinkTimeInput.blur();
  });
  for (const button of document.querySelectorAll("[data-think-time]")) {
    button.addEventListener("click", () => setThinkTime(button.dataset.thinkTime));
  }

  // ---- 自由难度模式：9 档各自保存一份引擎参数 ----
  elements.freeDifficultyToggle.addEventListener("change", () => {
    setFreeDifficultyEnabled(elements.freeDifficultyToggle.checked);
  });
  elements.difficultySlotList.addEventListener("click", (event) => {
    const slot = event.target.closest("[data-difficulty-slot]");
    if (!slot) return;
    selectDifficultySlot(slot.dataset.difficultySlot);
  });
  for (const input of [
    elements.freeDepthInput,
    elements.freeTopKInput,
    elements.freeTemperatureInput,
    elements.freeThinkInput,
  ]) {
    input.addEventListener("change", commitDifficultyInputs);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitDifficultyInputs();
      input.blur();
    });
  }
  elements.resetDifficultySlotBtn.addEventListener("click", resetDifficultySlot);
  elements.resetDifficultyAllBtn.addEventListener("click", resetAllDifficulties);

  elements.threadsInput.addEventListener("input", () => {
    elements.threadsInput.dataset.userEdited = "true";
    saveAppSettings();
  });
  elements.hashInput.addEventListener("input", () => {
    elements.hashInput.dataset.userEdited = "true";
    saveAppSettings();
  });
  elements.multiPvInput.addEventListener("input", saveAppSettings);
  elements.deepseekApiKey.addEventListener("input", () => {
    saveCommentarySettings();
    if (state.quipEnabled) schedulePositionCommentary();
  });
  elements.deepseekModel.addEventListener("input", saveCommentarySettings);
  elements.voiceSelect.addEventListener("change", saveCommentarySettings);
  elements.quipVoiceEnabled.addEventListener("change", () => {
    state.quipVoiceEnabled = elements.quipVoiceEnabled.checked;
    saveCommentarySettings();
    updateCommentaryUi();
    if (!state.quipVoiceEnabled) {
      voiceQueue.removePendingChannels("quip");
    }
  });
  elements.coachVoiceEnabled.addEventListener("change", () => {
    state.coachVoiceEnabled = elements.coachVoiceEnabled.checked;
    saveCommentarySettings();
    updateCommentaryUi();
    if (!state.coachVoiceEnabled) {
      voiceQueue.removePendingChannels("coach");
    }
  });
  elements.voiceShareEnabled.addEventListener("change", () => {
    state.voiceShareEnabled = elements.voiceShareEnabled.checked;
    saveCommentarySettings();
    showToast(
      state.voiceShareEnabled
        ? "跨设备语音同步已开启。"
        : "跨设备语音同步已关闭。",
    );
  });
  elements.speechRateInput.addEventListener("input", () => {
    state.speechRate = clampNumberSetting(
      elements.speechRateInput.value,
      1,
      2.5,
      1.5,
    );
    saveCommentarySettings();
    updateCommentaryUi();
  });
  elements.replayCommentaryBtn.addEventListener("click", () => {
    const text = state.lastCommentaryText.trim();
    if (!text) {
      showToast("还没有可重听的短评。");
      return;
    }
    speakCommentary(text, {
      channel: "manual",
      priority: VOICE_PRIORITY.MANUAL_PLAYBACK,
      auto: false,
    });
  });
  elements.testVoiceBtn.addEventListener("click", () => {
    speakCommentary("这一步有点意思，我先替你记下了。", {
      channel: "manual",
      priority: VOICE_PRIORITY.TEST,
      auto: false,
    });
  });
  elements.stopCommentaryBtn.addEventListener("click", stopCommentaryPlayback);
  elements.resetAllSettingsBtn.addEventListener("click", resetAllSettings);

  elements.applySettingsBtn.addEventListener("click", async () => {
    try {
      await applyEngineResourceSettings(readResourceInputs());
      showToast("性能设置已应用。");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    }
  });
  elements.resetSystemParamsBtn.addEventListener("click", () => {
    void resetSystemParameters();
  });

  elements.piecePalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-piece]");
    if (!button) return;
    state.editPiece = button.dataset.piece;
    for (const item of elements.piecePalette.querySelectorAll("[data-piece]")) {
      item.classList.toggle("active", item === button);
    }
  });

  elements.editTurnSelect.addEventListener("change", () => {
    state.turn = elements.editTurnSelect.value === "b" ? BLACK : RED;
    resetCurrentPosition();
    renderAll();
  });

  elements.clearBoardBtn.addEventListener("click", () => {
    state.board = createEmptyBoard();
    state.turn = RED;
    elements.editTurnSelect.value = RED;
    resetCurrentPosition();
    renderAll();
  });

  elements.initialPositionBtn.addEventListener("click", () => {
    const start = parseFen(START_FEN);
    state.board = cloneBoard(start.board);
    state.turn = start.turn;
    elements.editTurnSelect.value = start.turn;
    resetCurrentPosition();
    renderAll();
    showToast("已恢复初始局面。");
  });

  elements.loadFenBtn.addEventListener("click", async () => {
    if (await loadFen(elements.fenInput.value)) showToast("局面已载入。");
  });
  elements.copyFenBtn.addEventListener("click", () => copyText(elements.fenInput.value));
  elements.chooseVisionImageBtn.addEventListener("click", () => {
    elements.visionImageInput.click();
  });
  elements.visionImageInput.addEventListener("change", () => {
    void selectVisionImage(elements.visionImageInput.files?.[0]);
  });
  elements.recognizeVisionBtn.addEventListener("click", recognizeVisionPosition);
  elements.deepseekVisionModel.addEventListener("input", saveVisionSettings);
  elements.visionRefine.addEventListener("change", saveVisionSettings);

  elements.exitBtn.addEventListener("click", async () => {
    try {
      await api("/api/shutdown", {});
    } finally {
      window.close();
    }
  });

  window.addEventListener("beforeunload", () => {
    stopCommentaryPlayback();
    // 关页面只停搜索，绝不 quit 引擎进程：
    // 引擎是托盘常驻的，杀掉它会让其它标签页失效，也与使用说明的承诺相反。
    navigator.sendBeacon?.("/api/engine/stop", "{}");
  });

  // ---- 持续思考：页面切到后台自动暂停，回到前台恢复 ----
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (state.analysisActive || state.analysisStarting) {
        state.pausedByVisibility = true;
        void haltEngineSearch({
          detail: "页面切到后台，已暂停分析",
          pause: true,
          keepPendingMove: true,
        });
      }
      return;
    }
    if (!state.pausedByVisibility) return;
    state.pausedByVisibility = false;
    // 必须先清掉 analysisPaused，否则 startContinuousAnalysis 会被 analysisAllowed() 挡回来。
    state.analysisPaused = false;
    updateAnalysisControls();
    if (shouldKeepAnalyzing()) scheduleContinuousAnalysis(0);
  });
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.addEventListener("status", (event) => {
    const payload = JSON.parse(event.data);
    setEngineState(payload.status, payload.detail);
    if (payload.status === "error") {
      state.engineReady = false;
      showToast(payload.detail || "棋力引擎发生错误。", "error");
    }
  });
  source.addEventListener("info", (event) => {
    updateAnalysis(JSON.parse(event.data));
  });
  source.addEventListener("bestmove", (event) => {
    const payload = JSON.parse(event.data);
    // infinite / ponder 的结束由对应的分析流程自己收口，避免"计算完成"
    // 把正在显示的预判命中状态覆盖掉。
    if (
      payload.searchMode === "infinite" ||
      payload.searchMode === "ponder"
    ) {
      return;
    }
    // 复盘期间由复盘进度面板接管引擎状态，旧的实时搜索结束事件不得覆盖暂停提示。
    if (state.mode === "review") return;
    if (payload.bestmove) {
      setEngineState("ready", `计算完成：${payload.bestmove}`);
    }
  });
  // ---- 跨设备语音同步 ----
  // 同一局棋可能在电脑、手机、平板同时开着。谁说话就把文本广播出去，
  // 其它设备用各自的中文语音朗读，做到"不同设备的人也能听到吐槽录音"。
  source.addEventListener("voice", (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!payload) return;
    // 自己发出去的消息会原样回传，必须忽略，否则会无限回声。
    if (payload.origin === VOICE_CLIENT_ID) return;
    if (payload.action === "stop") {
      stopCommentaryPlayback({ broadcast: false });
      return;
    }
    if (payload.action !== "speak") return;
    const text = String(payload.text || "").trim();
    if (!text) return;
    speakCommentary(text, {
      channel: payload.channel === "quip" ? "quip" : "coach",
      priority: Number.isFinite(Number(payload.priority))
        ? Number(payload.priority)
        : VOICE_PRIORITY.AUTO_COACH,
      rate: Number.isFinite(Number(payload.rate)) ? Number(payload.rate) : undefined,
      // 远端语音必须当作"手动朗读"处理：
      // auto: false + generation: 0 让它不受本机代次切换影响，也不会被静音过滤。
      auto: false,
      generation: 0,
      // 不要再广播一次，避免设备之间互相转发形成回声。
      skipBroadcast: true,
    });
  });
  source.addEventListener("error", () => {
    // EventSource reconnects automatically when the local server returns.
  });
}

async function boot() {
  elements.boardGuides.innerHTML = createGuidesSvg();
  applyEndgamePresets();
  populatePersonaOptions();
  loadPersonaSettings();
  loadAppSettings();
  loadDifficultySettings();
  loadCommentarySettings();
  loadHintSettings();
  loadVisionSettings();
  refreshVoiceOptions();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      refreshVoiceOptions();
    });
  }
  setupEvents();
  connectEvents();
  updateMistakeBookUI();
  updateTrainingPanel();
  renderReviewTree();
  setReviewProgress(0, 0, "等待载入对局");
  updateReviewControls();
  // 不要在启动时调 setThinkTime：自由难度模式下它会把当前值写回档位配置，
  // 让"没改过任何参数"的档位被误标成已自定义。这里只做控件回填。
  syncThinkTimeControls({ force: true });
  setBoardFlipped(state.boardFlipped);
  refreshHintDisplay();
  applyFreePlayUi();
  applyContinuousThinkingUi();
  updateCoachUi();
  setSettingsOpen(false);
  renderLastMoveEvaluation(null);
  renderAll();

  try {
    const system = await fetch("/api/system").then((response) => response.json());
    updateSystemSummary(system);
    await initializeEngine();
    updateReviewControls();
  } catch (error) {
    state.engineReady = false;
    setEngineState("error", "无法载入");
    showToast(error instanceof Error ? error.message : String(error), "error");
    updateReviewControls();
  }
}

boot();
