import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineValues, sumMoney, numberWords } from '../shared/invoice-money.js';

test('shared decimal calculation handles half-cent tax, price and fractional quantity', () => {
  assert.deepEqual(lineValues({quantity:1,unitPrice:'42.70',rate:'5%'}),{taxable:42.70,tax:2.14,total:44.84});
  assert.deepEqual(lineValues({quantity:1,unitPrice:'10.075',rate:'18%'}),{taxable:10.08,tax:1.81,total:11.89});
  assert.deepEqual(lineValues({quantity:'0.3',unitPrice:'0.1',rate:'Exempt'}),{taxable:0.03,tax:0,total:0.03});
  assert.equal(sumMoney([0.1,0.2,2.14]),2.44);
});
test('shared calculator combines rates, adjustments and discounts using synthetic inputs', () => {
  const cases = [
    [{quantity:2,unitPrice:'250',rate:'18%',furtherTax:'20'}, {taxable:500,tax:90,total:610}],
    [{quantity:3,unitPrice:'33.335',rate:'5%',extraTax:'1.25',furtherTax:'2.50',fedPayable:'3.75',discount:'4.00'}, {taxable:100.01,tax:5,total:108.51}],
    [{quantity:1,unitPrice:'10',rate:'Exempt',extraTax:'0.4'}, {taxable:10,tax:0,total:10.4}],
    [{quantity:1,unitPrice:'200',rate:'0%',discount:'10'}, {taxable:200,tax:0,total:190}],
    [{quantity:2,unitPrice:'75',rate:'8%',salesTaxWithheldAtSource:'3'}, {taxable:150,tax:12,total:162}],
    [{quantity:1,unitPrice:'120',rate:'25%',discount:'5'}, {taxable:120,tax:30,total:145}],
  ];
  for (const [input, expected] of cases) assert.deepEqual(lineValues(input), expected);
});
test('amount in words preserves paisa, zero, whole rupees, carry and large totals', () => {
  for(const [value,expected] of [
    ['36.29','Thirty Six Rupees and Twenty Nine Paisa Only.'],
    [0,'Zero Rupees Only.'],[1,'One Rupee Only.'],['1.01','One Rupee and One Paisa Only.'],
    ['0.50','Zero Rupees and Fifty Paisa Only.'],['0.01','Zero Rupees and One Paisa Only.'],
    [36,'Thirty Six Rupees Only.'],['0.995','One Rupee Only.'],
    ['10000000000.29','One Thousand Crore Rupees and Twenty Nine Paisa Only.'],
  ])assert.equal(numberWords(value),expected);
});
