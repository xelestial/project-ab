import type {
  UnitMeta,
  WeaponMeta,
  SkillMeta,
  EffectMeta,
  TileAttributeMeta,
  MapMeta,
  ElementalReaction,
  UnitPassiveMeta,
} from "./schemas/metadata.js";
import {
  UnitMetaSchema,
  WeaponMetaSchema,
  SkillMetaSchema,
  EffectMetaSchema,
  TileAttributeMetaSchema,
  MapMetaSchema,
  ElementalReactionSchema,
  UnitPassiveMetaSchema,
} from "./schemas/metadata.js";
import { ErrorCode } from "./error-codes.js";
import { getText } from "./i18n.js";

// ─── Interface (P-02) ─────────────────────────────────────────────────────────

export interface IDataRegistry {
  getUnit(id: string): UnitMeta;
  getWeapon(id: string): WeaponMeta;
  getSkill(id: string): SkillMeta;
  getEffect(id: string): EffectMeta;
  getTile(id: string): TileAttributeMeta;
  getMap(id: string): MapMeta;

  getAllUnits(): readonly UnitMeta[];
  getAllWeapons(): readonly WeaponMeta[];
  getAllSkills(): readonly SkillMeta[];
  getAllEffects(): readonly EffectMeta[];
  getAllTiles(): readonly TileAttributeMeta[];
  getAllMaps(): readonly MapMeta[];

  getEffectByType(effectType: string): EffectMeta | undefined;
  getTileByType(tileType: string): TileAttributeMeta | undefined;
  getElementalReactions(): readonly ElementalReaction[];

  getUnitPassive(id: string): UnitPassiveMeta;
  getUnitPassives(unitMetaId: string): readonly UnitPassiveMeta[];
}

// ─── RegistryError ────────────────────────────────────────────────────────────

export class RegistryError extends Error {
  constructor(
    public readonly code: string,
    public readonly entityId: string,
    public readonly entityType: string,
  ) {
    super(`[${code}] ${entityType} not found: "${entityId}"`);
    this.name = "RegistryError";
  }
}

// ─── DataRegistry implementation ─────────────────────────────────────────────

export class DataRegistry implements IDataRegistry {
  private readonly units = new Map<string, UnitMeta>();
  private readonly weapons = new Map<string, WeaponMeta>();
  private readonly skills = new Map<string, SkillMeta>();
  private readonly effects = new Map<string, EffectMeta>();
  private readonly tiles = new Map<string, TileAttributeMeta>();
  private readonly maps = new Map<string, MapMeta>();
  private readonly elementalReactions: ElementalReaction[] = [];
  private readonly unitPassives = new Map<string, UnitPassiveMeta>();

  // ── Loading ────────────────────────────────────────────────────────────────

  loadUnits(raw: unknown[]): void {
    for (const item of raw) {
      const parsed = UnitMetaSchema.parse(item);
      this.units.set(parsed.id, parsed);
    }
  }

  loadWeapons(raw: unknown[]): void {
    for (const item of raw) {
      const parsed = WeaponMetaSchema.parse(item);
      this.weapons.set(parsed.id, parsed);
    }
  }

  loadSkills(raw: unknown[]): void {
    for (const item of raw) {
      const parsed = SkillMetaSchema.parse(item);
      this.skills.set(parsed.id, parsed);
    }
  }

  loadEffects(raw: unknown[]): void {
    for (const item of raw) {
      const parsed = EffectMetaSchema.parse(item);
      this.effects.set(parsed.id, parsed);
    }
  }

  loadTiles(raw: unknown[]): void {
    for (const item of raw) {
      const parsed = TileAttributeMetaSchema.parse(item);
      this.tiles.set(parsed.id, parsed);
    }
  }

  loadMaps(raw: unknown[]): void {
    for (const item of raw) {
      const parsed = MapMetaSchema.parse(item);
      this.maps.set(parsed.id, parsed);
    }
  }

  loadElementalReactions(raw: unknown[]): void {
    this.elementalReactions.length = 0;
    for (const item of raw) {
      this.elementalReactions.push(ElementalReactionSchema.parse(item));
    }
  }

  loadUnitPassives(raw: unknown[]): void {
    for (const item of raw) {
      const parsed = UnitPassiveMetaSchema.parse(item);
      this.unitPassives.set(parsed.id, parsed);
    }
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  getUnit(id: string): UnitMeta {
    const v = this.units.get(id);
    if (v === undefined) {
      throw new RegistryError(ErrorCode.UNKNOWN_UNIT, id, "UnitMeta");
    }
    return v;
  }

  getWeapon(id: string): WeaponMeta {
    const v = this.weapons.get(id);
    if (v === undefined) {
      throw new RegistryError(ErrorCode.UNKNOWN_WEAPON, id, "WeaponMeta");
    }
    return v;
  }

  getSkill(id: string): SkillMeta {
    const v = this.skills.get(id);
    if (v === undefined) {
      throw new RegistryError(ErrorCode.SKILL_NOT_FOUND, id, "SkillMeta");
    }
    return v;
  }

  getEffect(id: string): EffectMeta {
    const v = this.effects.get(id);
    if (v === undefined) {
      throw new RegistryError(ErrorCode.UNKNOWN_EFFECT, id, "EffectMeta");
    }
    return v;
  }

  getTile(id: string): TileAttributeMeta {
    const v = this.tiles.get(id);
    if (v === undefined) {
      throw new RegistryError(ErrorCode.UNKNOWN_EFFECT, id, "TileAttributeMeta");
    }
    return v;
  }

  getMap(id: string): MapMeta {
    const v = this.maps.get(id);
    if (v === undefined) {
      throw new RegistryError(ErrorCode.UNKNOWN_MAP, id, "MapMeta");
    }
    return v;
  }

  getUnitPassive(id: string): UnitPassiveMeta {
    const v = this.unitPassives.get(id);
    if (v === undefined) {
      throw new RegistryError(ErrorCode.UNKNOWN_UNIT, id, "UnitPassiveMeta");
    }
    return v;
  }

  getUnitPassives(unitMetaId: string): readonly UnitPassiveMeta[] {
    const unitMeta = this.units.get(unitMetaId);
    if (unitMeta === undefined) return [];
    return unitMeta.passiveIds.map((pid) => {
      const p = this.unitPassives.get(pid);
      if (p === undefined) {
        throw new RegistryError(ErrorCode.UNKNOWN_UNIT, pid, "UnitPassiveMeta");
      }
      return p;
    });
  }

  // ── Collection getters ──────────────────────────────────────────────────────

  getAllUnits(): readonly UnitMeta[] {
    return [...this.units.values()];
  }

  getAllWeapons(): readonly WeaponMeta[] {
    return [...this.weapons.values()];
  }

  getAllSkills(): readonly SkillMeta[] {
    return [...this.skills.values()];
  }

  getAllEffects(): readonly EffectMeta[] {
    return [...this.effects.values()];
  }

  getAllTiles(): readonly TileAttributeMeta[] {
    return [...this.tiles.values()];
  }

  getAllMaps(): readonly MapMeta[] {
    return [...this.maps.values()];
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  /**
   * Find a TileAttributeMeta by tileType (not ID).
   * Useful when you know the tileType but not the ID.
   */
  getTileByType(tileType: string): TileAttributeMeta | undefined {
    for (const t of this.tiles.values()) {
      if (t.tileType === tileType) return t;
    }
    return undefined;
  }

  /** Find an EffectMeta by effectType */
  getEffectByType(effectType: string): EffectMeta | undefined {
    for (const e of this.effects.values()) {
      if (e.effectType === effectType) return e;
    }
    return undefined;
  }

  /** All elemental attack-vs-effect reaction rules */
  getElementalReactions(): readonly ElementalReaction[] {
    return this.elementalReactions;
  }

  getText(key: string): string {
    return getText(key);
  }
}

// ─── Factory helper ───────────────────────────────────────────────────────────

/**
 * Build a DataRegistry from plain JSON objects.
 * Typically called once at server startup.
 */
export function buildDataRegistry(data: {
  units: unknown[];
  weapons: unknown[];
  skills: unknown[];
  effects: unknown[];
  tiles: unknown[];
  maps: unknown[];
  elementalReactions?: unknown[];
  unitPassives?: unknown[];
}): DataRegistry {
  const reg = new DataRegistry();
  reg.loadWeapons(data.weapons);
  reg.loadSkills(data.skills);
  reg.loadEffects(data.effects);
  reg.loadTiles(data.tiles);
  reg.loadUnits(data.units);
  reg.loadMaps(data.maps);
  if (data.elementalReactions !== undefined) {
    reg.loadElementalReactions(data.elementalReactions);
  }
  if (data.unitPassives !== undefined) {
    reg.loadUnitPassives(data.unitPassives);
  }
  return reg;
}
