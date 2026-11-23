/**
 * 首次启动预置示例数据: 一套斜齿轮副 + 零误差 + 零修形方案
 */
import { getAllRecords, putRecord } from './database';
import type { AssemblyError } from '../gear/types';
import { uid } from '../gear/types';
import { defaultPlan } from '../gear/modification';
import { makeDefaultHelicalPair } from '../ui/pages/pairPage';

export async function seedIfEmpty(): Promise<void> {
  const pairs = await getAllRecords<{ id: string }>('pairs');
  if (pairs.length > 0) return;
  const pair = makeDefaultHelicalPair();
  await putRecord('pairs', pair);
  const plan = defaultPlan(pair.id, uid('plan'));
  plan.name = '零修形基准方案';
  await putRecord('plans', plan);
  const asm: AssemblyError = {
    id: uid('asm'),
    name: '零误差基准',
    updatedAt: Date.now(),
    pairId: pair.id,
    centerDistanceError: 0,
    parallelismInPlane: 0,
    parallelismCross: 0,
    pinionMountingError: 0,
    gearMountingError: 0,
    shaftAngleError: 0,
    housingTorque: 500,
    housingStiffness: 2e6,
  };
  await putRecord('assemblies', asm);
}
