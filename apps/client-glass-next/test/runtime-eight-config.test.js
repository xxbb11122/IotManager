import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectedExecutions, requireRuntimePhase } from '../../../scripts/testing/runtime-eight/phases.mjs';

test('every launched runtime phase loads the real Playwright config with a distinct evidence file',async()=>{
  const launcher=readFileSync(new URL('../../../scripts/testing/runtime-eight/run.sh',import.meta.url),'utf8');
  const launched=[...launcher.matchAll(/^run_tests ([a-z-]+) /gm)].map(value=>value[1]);
  assert.deepEqual(launched.sort(),Object.keys(expectedExecutions).sort());
  assert.ok(launched.includes('rollback-resume'));
  const previous=process.env.IOT_EIGHT_PHASE;
  try{
    for(const phase of launched){
      process.env.IOT_EIGHT_PHASE=phase;
      const url=new URL(`../../../scripts/testing/runtime-eight/playwright.config.mjs?probe=${phase}`,import.meta.url);
      const {default:config}=await import(url.href);
      assert.ok(config.reporter.some(([name,options])=>name==='json'&&options.outputFile.endsWith(`/artifacts/runtime-eight/${phase}.json`)));
      assert.ok(config.outputDir.endsWith(`/playwright/${phase}`));
    }
    for(const invalid of [undefined,'','../outside','__proto__','constructor'])assert.throws(()=>requireRuntimePhase(invalid),/explicit/);
    process.env.IOT_EIGHT_PHASE='../outside';
    await assert.rejects(import(new URL('../../../scripts/testing/runtime-eight/playwright.config.mjs?probe=invalid',import.meta.url).href),/explicit/);
  }finally{if(previous===undefined)delete process.env.IOT_EIGHT_PHASE;else process.env.IOT_EIGHT_PHASE=previous;}
});
