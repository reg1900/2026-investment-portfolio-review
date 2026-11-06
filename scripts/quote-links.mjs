export const holdingNames = {
  '0050':'元大台灣50','00713':'元大高息低波','00631L':'元大台灣50正2',
  '00919':'群益台灣精選高息','00878':'國泰永續高股息','00937B':'群益ESG投等債20+',
  '00751B':'元大AAA至A公司債','00933B':'國泰10Y+金融債','00406A':'主動中信台灣收益',
};

export const quoteLinks = {
  ...Object.fromEntries(['0050','00713','00631L','00919','00878','00406A'].map(code =>
    [code, `https://tw.stock.yahoo.com/quote/${code}.TW`])),
  ...Object.fromEntries(['00937B','00751B','00933B'].map(code =>
    [code, `https://tw.stock.yahoo.com/quote/${code}.TWO`])),
  '富達永續':'https://www.fidelity.com.tw/fund-and-service/fundui/funds/Fidelity-Funds-Global-Dividend-Plus-Fund-B-MCDIST-G-USD-hedged/overview',
  '施羅德環球':'https://www.schroders.com/zh-tw/tw/individual/fund-centre/?language=zh-tw&location=tw&channel=individual&clientId=schdr&clientVersion=v1&externalId=SCHDR_F000011DCB&r=%2Ffund%2FSCHDR_F000011DCB%2F',
};
