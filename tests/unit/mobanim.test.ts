import { describe, expect, it } from 'vitest';
import { MOB, MOB_FLAG, mobDef } from '../../src/shared/br/adventure';
import { MOB_EVENT, MobAnimator, gaitOf } from '../../src/client/game/mobanim';

const mob = (kind: number, over: Partial<{ hp: number; flags: number; ang: number }> = {}) => ({
  id: 7,
  hp: 100,
  flags: 0,
  ang: 0,
  ...over,
});

function run(
  anim: MobAnimator,
  m: ReturnType<typeof mob>,
  kind: number,
  now: number,
  moving: boolean,
) {
  anim.beginFrame();
  const pose = anim.pose(m, mobDef(kind), now, moving);
  anim.endFrame();
  return pose;
}

describe('animacion de enemigos', () => {
  it('aparece creciendo desde el suelo y lo avisa una sola vez', () => {
    const a = new MobAnimator();
    const first = run(a, mob(MOB.rata), MOB.rata, 1000, false);
    expect(first.events & MOB_EVENT.spawn).toBe(MOB_EVENT.spawn);
    expect(first.sx).toBeLessThan(0.6);
    const later = run(a, mob(MOB.rata), MOB.rata, 1400, false);
    expect(later.events & MOB_EVENT.spawn).toBe(0);
    expect(later.sx).toBeGreaterThan(0.9);
    expect(later.sx).toBeLessThan(1.1);
  });

  it('respirando quieto se mueve apenas; caminando se aplasta y rebota mas', () => {
    const a = new MobAnimator();
    run(a, mob(MOB.perro), MOB.perro, 0, false);
    let idleMax = 0;
    let walkMax = 0;
    for (let t = 600; t < 2600; t += 20)
      idleMax = Math.max(idleMax, Math.abs(run(a, mob(MOB.perro), MOB.perro, t, false).sy - 1));
    for (let t = 2600; t < 4600; t += 20)
      walkMax = Math.max(walkMax, Math.abs(run(a, mob(MOB.perro), MOB.perro, t, true).sy - 1));
    expect(idleMax).toBeLessThan(0.04);
    expect(walkMax).toBeGreaterThan(idleMax * 2);
  });

  it('un golpe aplasta al enemigo de lado y se le pasa en menos de un cuarto de segundo', () => {
    const a = new MobAnimator();
    run(a, mob(MOB.golem), MOB.golem, 0, false);
    run(a, mob(MOB.golem), MOB.golem, 500, false);
    const hit = run(a, mob(MOB.golem, { hp: 80 }), MOB.golem, 520, false);
    expect(hit.events & MOB_EVENT.hit).toBe(MOB_EVENT.hit);
    expect(hit.sx).toBeGreaterThan(1.1);
    expect(hit.sy).toBeLessThan(0.92);
    const calm = run(a, mob(MOB.golem, { hp: 80 }), MOB.golem, 800, false);
    expect(calm.events & MOB_EVENT.hit).toBe(0);
    expect(Math.abs(calm.sx - 1)).toBeLessThan(0.05);
  });

  it('prepara el golpe encogiendose y al soltarlo embiste hacia donde mira', () => {
    const a = new MobAnimator();
    const m = mob(MOB.perro, { ang: 0 });
    run(a, m, MOB.perro, 0, false);
    run(a, m, MOB.perro, 600, false);
    const winding = run(a, { ...m, flags: MOB_FLAG.windup }, MOB.perro, 650, false);
    const wound = run(a, { ...m, flags: MOB_FLAG.windup }, MOB.perro, 900, false);
    expect(wound.sy).toBeLessThan(winding.sy);
    expect(wound.offX).toBeLessThan(0);
    const lunge = run(a, m, MOB.perro, 920, false);
    expect(lunge.events & MOB_EVENT.lunge).toBe(MOB_EVENT.lunge);
    expect(lunge.offX).toBeGreaterThan(3);
    const after = run(a, m, MOB.perro, 1400, false);
    expect(Math.abs(after.offX)).toBeLessThan(0.5);
  });

  it('solo los pesados hacen temblar el suelo al caminar', () => {
    const count = (kind: number): number => {
      const a = new MobAnimator();
      let stomps = 0;
      for (let t = 0; t < 4000; t += 16)
        if (run(a, mob(kind), kind, t, true).events & MOB_EVENT.stomp) stomps++;
      return stomps;
    };
    expect(count(MOB.golem)).toBeGreaterThanOrEqual(4);
    expect(count(MOB.perroGuardian)).toBeGreaterThanOrEqual(3);
    expect(count(MOB.rata)).toBe(0);
    expect(count(MOB.murcielago)).toBe(0);
  });

  it('los que vuelan flotan sobre el suelo y los que saltan se despegan', () => {
    expect(gaitOf(mobDef(MOB.murcielago)).hover).toBeGreaterThan(0);
    expect(gaitOf(mobDef(MOB.buhoAnciano)).hover).toBeGreaterThan(gaitOf(mobDef(MOB.buho)).hover);
    expect(gaitOf(mobDef(MOB.rata)).hover).toBe(0);
    const a = new MobAnimator();
    let maxLift = 0;
    run(a, mob(MOB.hongo), MOB.hongo, 0, true);
    for (let t = 400; t < 3000; t += 20)
      maxLift = Math.max(maxLift, run(a, mob(MOB.hongo), MOB.hongo, t, true).lift);
    expect(maxLift).toBeGreaterThan(1.5);
  });

  it('se olvida de los enemigos que ya no estan', () => {
    const a = new MobAnimator();
    run(a, mob(MOB.rata), MOB.rata, 0, false);
    expect(a.tracked).toBe(1);
    a.beginFrame();
    a.endFrame();
    expect(a.tracked).toBe(0);
  });
});
