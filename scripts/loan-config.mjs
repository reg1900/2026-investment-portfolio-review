import {loanSchedule} from './portfolio-math.mjs';
const originalPrincipal=8700000,annualRate=2.3,originalMonths=360,paidInstallments=1;
const original=loanSchedule({principal:originalPrincipal,annualRate,remainingMonths:originalMonths});
export const loanConfig={
  principal:Number(original.schedule[paidInstallments-1].balance.toFixed(2)),
  annualRate,remainingMonths:originalMonths-paidInstallments,repayment:'annuity',
  originalPrincipal,originalMonths,paidInstallments,confirmed:true,asOf:'2026-10-25',
};
