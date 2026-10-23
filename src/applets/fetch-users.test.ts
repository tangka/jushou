import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAppletUserMetric } from './fetch-users.js';

test('parseAppletUserMetric extracts cumulative users and data date', () => {
  const metric = parseAppletUserMetric(
    {
      ret: 0,
      respCode: 0,
      dynamicResps: [{ fieldId: 'data_time', fieldValue: '1784908800' }],
      objects: { tableValueLine: [{ columnValue: ['325', '64', '', '', '', '正常'] }] },
    },
    0
  );

  assert.equal(metric.cumulativeUsers, 325);
  assert.equal(metric.dataDate, '2026-07-25');
});

test('parseAppletUserMetric rejects a missing cumulative user value', () => {
  assert.throws(
    () => parseAppletUserMetric({ ret: 0, objects: { tableValueLine: [] } }, 1784908800),
    /累计用户字段非法/
  );
});

test('parseAppletUserMetric rejects delayed placeholder data', () => {
  assert.throws(
    () =>
      parseAppletUserMetric(
        {
          ret: 0,
          dynamicResps: [
            { fieldId: 'data_time', fieldValue: '1785513600' },
            { fieldId: 'is_delay', fieldValue: '1' },
          ],
          objects: { tableValueLine: [{ columnValue: ['0', '', '', '', '', ''] }] },
        },
        0
      ),
    /数据尚未结算/
  );
});
