import whatEffectRegistry from '../data/what_effects.json' with { type: 'json' }

const OPERATIONS = new Set(['move', 'add', 'max', 'set'])
const WRITABLE_FIELDS = new Set([
  'skipTurns',
  'skipReason',
  'skillBlockedTurns',
  'skillRefreshPending',
])
const CONDITION_FIELDS = new Set(['skillCooldownUntil'])
const CONTEXT_VALUES = new Set(['now', 'what.name'])

function fail(message) {
  throw new Error(`WHAT effect registry: ${message}`)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validateTypedValue(value, type, location) {
  if (type === 'positive_integer' && !isPositiveInteger(value)) {
    fail(`${location} must be a positive integer.`)
  }
  if (type !== 'positive_integer') fail(`${location} uses unsupported value type "${type}".`)
}

function valueFrom(source, effect, location) {
  const fields = Array.isArray(source) ? source : [source]
  const field = fields.find(candidate => effect[candidate] !== undefined)
  if (!field) fail(`${location} could not find a value in ${fields.join(', ')}.`)
  return effect[field]
}

function contextValue(name, context, location) {
  if (!CONTEXT_VALUES.has(name)) fail(`${location} uses unsupported context value "${name}".`)
  if (name === 'now') return context.now
  if (name === 'what.name') return context.what.name
  return undefined
}

function conditionMatches(condition, player, context, location) {
  if (!condition) return true
  if (!CONDITION_FIELDS.has(condition.field)) {
    fail(`${location} reads unsafe condition field "${condition.field}".`)
  }
  const right = condition.context_value
    ? contextValue(condition.context_value, context, `${location}.context_value`)
    : condition.value
  if (condition.comparison === 'greater_than') return player[condition.field] > right
  if (condition.comparison === 'equals') return player[condition.field] === right
  fail(`${location} uses unsupported comparison "${condition.comparison}".`)
}

function validateOperation(operation, effectId, index) {
  const location = `effect "${effectId}" operation[${index}]`
  if (!OPERATIONS.has(operation.operation)) {
    fail(`${location} uses unsupported operation "${operation.operation}".`)
  }
  if (operation.operation === 'move') {
    if (!operation.amount_from) fail(`${location} requires amount_from.`)
    if (!Number.isFinite(operation.multiplier)) fail(`${location} requires a numeric multiplier.`)
    return
  }
  if (!WRITABLE_FIELDS.has(operation.target)) {
    fail(`${location} writes unsafe target "${operation.target}".`)
  }
  if (operation.operation === 'add' || operation.operation === 'max') {
    if (!operation.amount_from) fail(`${location} requires amount_from.`)
  }
  if (operation.operation === 'set') {
    const hasValue = Object.hasOwn(operation, 'value')
    if (!hasValue && !operation.context_value) fail(`${location} requires value or context_value.`)
    if (operation.context_value) contextValue(operation.context_value, { now: 0, what: { name: '' } }, `${location}.context_value`)
  }
  if (operation.when) {
    conditionMatches(operation.when, { skillCooldownUntil: 0 }, { now: 0, what: { name: '' } }, `${location}.when`)
  }
}

export function validateEffectRegistry(registry = whatEffectRegistry) {
  if (!registry || registry.version !== 1 || !registry.effects || typeof registry.effects !== 'object') {
    fail('expected version 1 with an effects object.')
  }
  for (const [effectId, definition] of Object.entries(registry.effects)) {
    if (Object.hasOwn(definition, 'description')) {
      fail(`effect "${effectId}" must not define a description; descriptions belong in boards.json.`)
    }
    for (const [field, type] of Object.entries(definition.required || {})) {
      validateTypedValue(1, type, `effect "${effectId}" required field "${field}"`)
    }
    if (definition.required_one_of) {
      if (!Array.isArray(definition.required_one_of.fields) || definition.required_one_of.fields.length === 0) {
        fail(`effect "${effectId}" required_one_of requires a non-empty fields array.`)
      }
      validateTypedValue(1, definition.required_one_of.type, `effect "${effectId}" required_one_of`)
    }
    if (!Array.isArray(definition.operations) || definition.operations.length === 0) {
      fail(`effect "${effectId}" requires at least one operation.`)
    }
    definition.operations.forEach((operation, index) => validateOperation(operation, effectId, index))
  }
  return registry
}

export function validateBoardWhats(boards, registry = whatEffectRegistry) {
  validateEffectRegistry(registry)
  for (const board of boards) {
    for (const what of board.whats || []) {
      if (!Array.isArray(what.effects) || what.effects.length === 0) {
        fail(`Board "${board.name}" WHAT "${what.name}" requires a non-empty effects array.`)
      }
      what.effects.forEach((effect, index) => {
        const location = `Board "${board.name}" WHAT "${what.name}" effect[${index}]`
        if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
          fail(`${location} must be an object.`)
        }
        const definition = registry.effects[effect.effect]
        if (!definition) fail(`${location} references unknown effect "${effect.effect}".`)
        if (typeof effect.description !== 'string' || !effect.description.trim()) {
          fail(`${location} requires a non-empty string description in boards.json.`)
        }
        for (const [field, type] of Object.entries(definition.required || {})) {
          validateTypedValue(effect[field], type, `${location}.${field}`)
        }
        if (definition.required_one_of) {
          const field = definition.required_one_of.fields.find(candidate => effect[candidate] !== undefined)
          if (!field) fail(`${location} requires one of ${definition.required_one_of.fields.join(', ')}.`)
          validateTypedValue(effect[field], definition.required_one_of.type, `${location}.${field}`)
        }
      })
    }
  }
  return true
}

export function createWhatEffectExecutor(registry = whatEffectRegistry) {
  validateEffectRegistry(registry)
  return function executeWhatEffects({ player, what, now = Date.now(), move }) {
    const steps = []
    for (const effect of what.effects || []) {
      const definition = registry.effects[effect.effect]
      if (!definition) fail(`WHAT "${what.name}" references unknown effect "${effect.effect}".`)
      const from = player.space
      const context = { now, what }

      for (const [index, operation] of definition.operations.entries()) {
        const location = `effect "${effect.effect}" operation[${index}]`
        if (!conditionMatches(operation.when, player, context, `${location}.when`)) continue
        if (operation.operation === 'move') {
          const amount = valueFrom(operation.amount_from, effect, location)
          move(player.space + amount * operation.multiplier)
        } else if (operation.operation === 'add') {
          player[operation.target] += valueFrom(operation.amount_from, effect, location)
        } else if (operation.operation === 'max') {
          player[operation.target] = Math.max(
            player[operation.target],
            valueFrom(operation.amount_from, effect, location),
          )
        } else if (operation.operation === 'set') {
          player[operation.target] = operation.context_value
            ? contextValue(operation.context_value, context, `${location}.context_value`)
            : operation.value
        }
      }

      steps.push({
        definition: { ...effect },
        from,
        destination: player.space,
      })
      if (player.eliminated) break
    }
    return steps
  }
}

export const executeRegisteredWhatEffects = createWhatEffectExecutor()
