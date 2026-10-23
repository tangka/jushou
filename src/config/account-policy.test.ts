import '../test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { testOperatorProfile, writeTestOperatorProfile } from '../test-support/operator-profile-fixture.js';
import { validateAccountPostTypePolicy } from '../wechat/editorial-quality.js';
import { validateWechatArticleMiniProgram } from '../wechat/link-policy.js';
import {
  accountEditorialInstruction,
  accountPolicy,
  appletMembershipImports,
  configuredDailyAccounts,
} from './account-policy.js';

test('empty private profile carries no account permissions, entry requirements or financial rules', () => {
  writeTestOperatorProfile({ version: 1 });
  try {
    assert.deepEqual(configuredDailyAccounts(), {});
    assert.deepEqual(appletMembershipImports(), []);
    assert.deepEqual(accountPolicy('Example News'), { dailyPublication: 'draft', newsOnly: false, routingGuards: [] });
    assert.doesNotThrow(() => validateWechatArticleMiniProgram('<p>正文</p>', 'Example News'));
    assert.doesNotThrow(() =>
      validateAccountPostTypePolicy({ accountExact: 'Example News', postType: '贴图', brief: undefined })
    );
  } finally {
    writeTestOperatorProfile();
  }
});

test('account aliases select their own rules without borrowing rules from another account', () => {
  assert.equal(accountPolicy('示例新闻').newsOnly, true);
  assert.equal(accountPolicy('example-lab').dailyPublication, 'publish');
  assert.equal(accountPolicy('example-notes').miniProgram, undefined);
  assert.equal(accountPolicy('unconfigured').dailyPublication, 'draft');
  assert.equal(accountEditorialInstruction('example-news', 'authorVoice', '默认表达'), '默认表达');
});

test('invalid import markers and partial mini-program targets fail instead of broadening policy', () => {
  writeTestOperatorProfile({
    ...testOperatorProfile,
    business: { appletMembershipImports: [{ service: '会员', marker: '*:' }] },
  });
  try {
    assert.throws(() => appletMembershipImports());
    writeTestOperatorProfile({
      ...testOperatorProfile,
      accounts: [
        {
          ...testOperatorProfile.accounts[0],
          policy: { miniProgram: { required: true, appid: 'wx1111111111111111' } },
        },
      ],
    });
    assert.throws(() => accountPolicy('example-news'), /appid 和 path/u);
  } finally {
    writeTestOperatorProfile();
  }
});
