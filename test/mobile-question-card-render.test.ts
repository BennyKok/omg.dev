import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
test('question card dismisses and takes a key in a password field',()=>{
 const result=Bun.spawnSync(['bun','test','./mobile/scripts/question-card.native-check.tsx'],{cwd:resolve(import.meta.dir,'..'),stdout:'pipe',stderr:'pipe'});
 if(result.exitCode!==0)throw new Error(new TextDecoder().decode(result.stderr));
 expect(result.exitCode).toBe(0);
});
