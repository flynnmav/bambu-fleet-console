// Read-only AMS telemetry. Field/bit definitions follow Bambu Studio DevFilaSystem/DevDefs.
const MODELS = { 1: 'AMS', 2: 'AMS lite', 3: 'AMS 2 Pro', 4: 'AMS HT' };
const DRY_STATES = { 0: 'off', 1: 'checking', 2: 'drying', 3: 'cooling', 4: 'stopping', 5: 'error', 6: 'error' };
const PHASES = { 0: 'off', 1: 'heating', 2: 'dehumidifying' };
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const objectLike = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function number(value, min, max, integer = false) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:[.]\d*)?|[.]\d+)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max && (!integer || Number.isInteger(parsed)) ? parsed : null;
}
function string(value, max = 128) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
function hex(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^0x/i, '');
  return /^[0-9a-f]{1,128}$/i.test(raw) ? BigInt('0x' + raw) : null;
}
function bits(value, offset, width = 1) {
  return value == null ? null : Number((value >> BigInt(offset)) & ((1n << BigInt(width)) - 1n));
}
function slotIndex(unitId, slotId) {
  const unit = number(unitId, 0, 3, true), slot = number(slotId, 0, 3, true);
  if (unit != null && slot != null) return unit * 4 + slot;
  const ht = number(unitId, 128, 135, true);
  return ht != null && Number(slotId) === 0 ? 16 + ht - 128 : null;
}
export function emptyAmsState() {
  return { trayNow: null, trayTarget: null, existBits: null, trayExistBits: null, trayReadingBits: null, statusCode: null, extruderSlots: {}, activeSource: null };
}
function presenceIndex(id) {
  const regular = number(id, 0, 3, true), ht = number(id, 128, 135, true);
  return regular ?? (ht == null ? null : 4 + ht - 128);
}
function legacyUnit(value) {
  if (value == null) return null;
  return value >= 0 && value <= 15 ? String(Math.floor(value / 4)) : value >= 128 && value <= 135 ? String(value) : null;
}
export function invalidateAmsState(previous, ids) {
  const state = { ...emptyAmsState(), ...previous, extruderSlots: { ...previous?.extruderSlots } };
  if (!ids.length) return state;
  const removed = new Set(ids);
  if (removed.has(legacyUnit(state.trayNow))) state.trayNow = null;
  if (removed.has(legacyUnit(state.trayTarget))) state.trayTarget = null;
  for (const [id, slot] of Object.entries(state.extruderSlots)) if (slot && removed.has(slot.unitId)) state.extruderSlots[id] = null;
  for (const key of ['existBits', 'trayExistBits', 'trayReadingBits', 'trayReadDoneBits', 'trayBambuBits']) state[key] = null;
  return state;
}
function blankUnit(id) {
  return { id, model: null, modelSource: null, serial: null, firmwareVersion: null, hardwareVersion: null, present: null, modelEvidence: {}, modelConflict: false, rawInfo: null,
    humidity: null, humidityLevelRaw: null, humidityPercent: null, temperature: null, activeTrayId: null, feedState: 'unknown', lastUpdated: null,
    drying: { supported: null, state: 'unknown', rawState: null, phase: 'unknown', fan1: 'unknown', fan2: 'unknown', targetTemperature: null, remainingMinutes: null, durationHours: null, filament: null }, trays: [] };
}
function applyModel(unit, label, source, origin = 'info') {
  if (!label) return;
  if (source === 'reported') {
    unit.modelEvidence = { ...unit.modelEvidence, [origin]: label };
    const labels = new Set(Object.values(unit.modelEvidence));
    unit.modelConflict = labels.size > 1;
    if (unit.modelConflict) { unit.model = null; unit.modelSource = null; unit.drying.supported = null; return; }
  } else if (unit.modelSource === 'reported' || unit.modelConflict) return;
  unit.model = label;
  unit.modelSource = source;
  unit.drying.supported = ['AMS 2 Pro', 'AMS HT'].includes(label) ? true : ['AMS', 'AMS lite'].includes(label) ? false : null;
}
function clearTray(tray) {
  Object.assign(tray, { material: '未知耗材', name: null, filamentId: null, tagUid: null, observedTagUid: null, trayUuid: null, observedTrayUuid: null, color: '#c8cec9', remaining: null });
}
function cloneUnits(previous) {
  return previous.map(unit => ({ ...blankUnit(unit.id), ...unit, drying: { ...blankUnit(unit.id).drying, ...unit.drying }, trays: unit.trays.map(tray => ({ ...tray })) }));
}

export function normalizeAmsReport(report, previous = [], previousState, { amsModels = {}, statusCode, extruders } = {}) {
  if (!objectLike(report)) report = {};
  let units = cloneUnits(previous);
  const freshPresence = owns(report, 'ams_exist_bits') ? hex(report.ams_exist_bits) : null;
  const reattached = units.filter(unit => unit.present === false && freshPresence != null && presenceIndex(unit.id) != null && bits(freshPresence, presenceIndex(unit.id)) === 1).map(unit => unit.id);
  const detached = units.filter(unit => unit.present !== false && freshPresence != null && presenceIndex(unit.id) != null && bits(freshPresence, presenceIndex(unit.id)) === 0).map(unit => unit.id);
  units = units.map(unit => reattached.includes(unit.id) ? blankUnit(unit.id) : unit);
  const state = invalidateAmsState(previousState, [...reattached, ...detached]);
  for (const extruder of Array.isArray(extruders) ? extruders : []) {
    if (!objectLike(extruder) || !owns(extruder, 'snow') || number(extruder.id, 0, 255, true) == null) continue;
    const snow = number(extruder.snow, 0, 65535, true);
    state.extruderSlots[String(Number(extruder.id))] = snow == null ? null : { unitId: String(Math.floor(snow / 256)), slotId: String(snow % 256) };
  }
  state.activeSource = Object.keys(state.extruderSlots).length ? 'extruder' : state.trayNow == null ? null : 'legacy';
  for (const [raw, key] of [['ams_exist_bits', 'existBits'], ['tray_exist_bits', 'trayExistBits'], ['tray_reading_bits', 'trayReadingBits'], ['tray_read_done_bits', 'trayReadDoneBits'], ['tray_is_bbl_bits', 'trayBambuBits']]) {
    if (owns(report, raw)) state[key] = hex(report[raw])?.toString(16) ?? null;
  }
  if (owns(report, 'tray_now')) state.trayNow = number(report.tray_now, 0, 255, true);
  if (owns(report, 'tray_tar')) state.trayTarget = number(report.tray_tar, 0, 255, true);
  if (statusCode !== undefined) state.statusCode = number(statusCode, 0, 65535, true);
  for (const update of Array.isArray(report.ams) ? report.ams : []) {
    if (!objectLike(update) || number(update.id, 0, 255, true) == null) continue;
    const id = String(Number(update.id));
    let unit = units.find(item => item.id === id);
    if (!unit) { unit = blankUnit(id); units.push(unit); }
    if (Object.keys(update).some(key => key !== 'id')) unit.lastUpdated = new Date().toISOString();
    if (owns(update, 'temp')) unit.temperature = number(update.temp, -40, 200);
    if (owns(update, 'humidity')) {
      unit.humidityLevelRaw = ['string', 'number'].includes(typeof update.humidity) ? String(update.humidity) : null;
      const level = number(update.humidity, 1, 5, true);
      unit.humidity = level == null ? null : String(level);
    }
    if (owns(update, 'humidity_raw')) unit.humidityPercent = number(update.humidity_raw, 0, 100);
    if (owns(update, 'dry_time')) unit.drying.remainingMinutes = number(update.dry_time, 0, 65535, true);
    if (owns(update, 'info')) {
      const info = hex(update.info);
      unit.rawInfo = info?.toString(16) ?? null;
      applyModel(unit, MODELS[bits(info, 0, 4)], 'reported');
      unit.drying.rawState = bits(info, 4, 4);
      unit.drying.state = DRY_STATES[unit.drying.rawState] ?? 'unknown';
      unit.drying.phase = PHASES[bits(info, 22, 2)] ?? 'unknown';
      for (const [key, offset] of [['fan1', 18], ['fan2', 20]]) {
        const value = bits(info, offset, 2);
        unit.drying[key] = value === 0 ? 'off' : value === 1 ? 'on' : 'unknown';
      }
    }
    if (objectLike(update.dry_setting)) {
      const settings = update.dry_setting;
      if (owns(settings, 'dry_temperature')) unit.drying.targetTemperature = number(settings.dry_temperature, 0, 150);
      if (owns(settings, 'dry_duration')) unit.drying.durationHours = number(settings.dry_duration, 0, 72);
      if (owns(settings, 'dry_filament')) unit.drying.filament = string(settings.dry_filament);
    }
    for (const rawTray of Array.isArray(update.tray) ? update.tray : []) {
      if (!objectLike(rawTray) || number(rawTray.id, 0, 255, true) == null) continue;
      const trayId = String(Number(rawTray.id));
      let tray = unit.trays.find(item => item.id === trayId);
      if (!tray) {
        tray = { id: trayId, material: '未知耗材', color: '#c8cec9', remaining: null, empty: null, active: null, reading: null, readDone: null, isBambu: null, name: null, filamentId: null, tagUid: null, observedTagUid: null, trayUuid: null, observedTrayUuid: null };
        unit.trays.push(tray);
      }
      if (owns(rawTray, 'tray_type')) {
        tray.material = string(rawTray.tray_type) || '未知耗材';
        if (tray.empty == null && string(rawTray.tray_type)) tray.empty = false;
      }
      if (owns(rawTray, 'tray_sub_brands')) tray.name = string(rawTray.tray_sub_brands);
      if (owns(rawTray, 'tray_info_idx')) tray.filamentId = string(rawTray.tray_info_idx);
      if (owns(rawTray, 'tag_uid')) {
        const uid = string(rawTray.tag_uid);
        tray.observedTagUid = uid && !/^0+$/.test(uid) ? uid : null;
        if (tray.observedTagUid) tray.tagUid = tray.observedTagUid;
      }
      if (owns(rawTray, 'tray_uuid')) {
        const uuid = string(rawTray.tray_uuid);
        tray.observedTrayUuid = uuid && !/^0+$/.test(uuid) ? uuid : null;
        if (tray.observedTrayUuid) tray.trayUuid = tray.observedTrayUuid;
      }
      if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(rawTray.tray_color ?? '')) tray.color = '#' + rawTray.tray_color.slice(0, 6);
      if (owns(rawTray, 'remain')) tray.remaining = number(rawTray.remain, 0, 100);
      if (owns(rawTray, 'state')) {
        const value = number(rawTray.state, 0, 0xffffffff, true);
        tray.rawState = value;
      }
    }
  }
  const exist = hex(state.existBits), trayExist = hex(state.trayExistBits), reading = hex(state.trayReadingBits);
  const readDone = hex(state.trayReadDoneBits), isBambu = hex(state.trayBambuBits);
  const slots = Object.values(state.extruderSlots);
  state.activeSource = slots.length ? 'extruder' : state.trayNow == null ? null : 'legacy';
  for (const unit of units) {
    if (unit.model === 'AMS lite' && unit.modelSource === 'reported') { unit.temperature = null; unit.humidity = null; unit.humidityPercent = null; }
    const hint = objectLike(amsModels) ? string(amsModels[unit.id]) : null;
    applyModel(unit, hint, 'configured');
    const unitNumber = number(unit.id, 0, 3, true);
    const htNumber = number(unit.id, 128, 135, true);
    const presenceBit = unitNumber ?? (htNumber == null ? null : 4 + htNumber - 128);
    if (presenceBit != null && exist != null) unit.present = bits(exist, presenceBit) === 1;
    else if (owns(report, 'ams_exist_bits') && exist == null) unit.present = null;
    unit.activeTrayId = null;
    for (const tray of unit.trays) {
      const index = slotIndex(unit.id, tray.id);
      if (index != null && trayExist != null) tray.empty = bits(trayExist, index) === 0;
      if (index != null && reading != null) tray.reading = bits(reading, index) === 1;
      if (index != null && readDone != null) tray.readDone = bits(readDone, index) === 1;
      if (index != null && isBambu != null) tray.isBambu = bits(isBambu, index) === 1;
      if (unit.present === false || tray.empty === true) tray.active = false;
      else if (slots.length) tray.active = slots.some(slot => slot?.unitId === unit.id && slot.slotId === tray.id) ? true : slots.some(slot => slot == null) ? null : false;
      else if (state.trayNow === 254 || state.trayNow === 255) tray.active = false;
      else if (state.trayNow >= 128 && state.trayNow <= 135) tray.active = unit.id === String(state.trayNow) && tray.id === '0';
      else tray.active = state.trayNow == null || state.trayNow > 15 || index == null ? null : state.trayNow === index;
      if (tray.active) unit.activeTrayId = tray.id;
      if (tray.empty === true || unit.present === false) { clearTray(tray); tray.reading = false; tray.readDone = false; tray.isBambu = null; }
      if (unit.present === false) tray.active = false;
    }
    let selectedSlot = null;
    if (slots.length) selectedSlot = slots.find(slot => slot?.unitId === unit.id)?.slotId ?? null;
    else if (legacyUnit(state.trayNow) === unit.id) selectedSlot = state.trayNow >= 128 ? '0' : String(state.trayNow % 4);
    const selectedTray = unit.trays.find(tray => tray.id === selectedSlot);
    if (unit.present === false) unit.feedState = 'unknown';
    else if (selectedSlot != null && selectedTray?.empty !== true) {
      unit.activeTrayId = selectedSlot;
      unit.feedState = 'selected';
    } else if (selectedSlot != null) unit.feedState = 'unknown';
    else if (slots.length) unit.feedState = slots.every(slot => slot && presenceIndex(slot.unitId) != null && slotIndex(slot.unitId, slot.slotId) != null) ? 'other-unit' : 'unknown';
    else if (state.trayNow === 254) unit.feedState = 'external';
    else if (state.trayNow === 255) unit.feedState = 'none';
    else unit.feedState = legacyUnit(state.trayNow) == null ? 'unknown' : 'other-unit';
    unit.trays.sort((a, b) => Number(a.id) - Number(b.id));
  }
  units.sort((a, b) => Number(a.id) - Number(b.id));
  return { units, state };
}

export function mergeAmsVersions(modules, previous = []) {
  const units = cloneUnits(previous);
  const replacedIds = [];
  for (const module of Array.isArray(modules) ? modules : []) {
    if (!objectLike(module)) continue;
    const match = /^(n3f|n3s|ams_f1|ams)(?:[/](\d+))?$/i.exec(module.name ?? '');
    if (!match) continue;
    const id = String(Number(match[2] ?? '0'));
    let unit = units.find(item => item.id === id);
    if (!unit) { unit = blankUnit(id); units.push(unit); }
    const newSerial = string(module.sn);
    if (newSerial && unit.serial && newSerial !== unit.serial) {
      const index = units.indexOf(unit);
      unit = blankUnit(id);
      units[index] = unit;
      replacedIds.push(id);
    }
    const kind = match[1].toLowerCase();
    const product = string(module.product_name) ?? '';
    const label = kind === 'n3f' || /^N3F/i.test(module.hw_ver ?? '') ? 'AMS 2 Pro'
      : kind === 'n3s' || /^N3S/i.test(module.hw_ver ?? '') ? 'AMS HT'
      : kind === 'ams_f1' || /ams.*lite/i.test(product) ? 'AMS lite' : kind === 'ams' ? 'AMS' : null;
    applyModel(unit, label, 'reported', 'version');
    if (owns(module, 'sn')) unit.serial = string(module.sn);
    if (owns(module, 'hw_ver')) unit.hardwareVersion = string(module.hw_ver);
    if (owns(module, 'sw_ver')) unit.firmwareVersion = string(module.sw_ver);
  }
  return { units, replacedIds };
}
