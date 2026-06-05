export interface QuerySignals {
  asksCode: boolean;
  asksTableNo: boolean;
  asksClause: boolean;
  asksDefinition: boolean;
  asksIndicator: boolean;
  asksConfiguration: boolean;
  asksDeliverable: boolean;
  asksDrawing: boolean;
  asksAttachmentOrDatabase: boolean;
  asksObligation: boolean;
  asksProcedure: boolean;
  asksChecklist: boolean;
  hasNumericFilter: boolean;
  rawKeywords: string[];
}

export function analyzeQuery(query: string): QuerySignals {
  const q = query.trim();
  const rawKeywords = new Set<string>();
  for (const match of q.matchAll(/[A-Za-z]\d{1,4}|\d+(?:\.\d+){1,}|第[零一二三四五六七八九十百千0-9]+条/g)) {
    rawKeywords.add(match[0]);
  }
  for (const keyword of [
    "代码",
    "表",
    "条",
    "定义",
    "指标",
    "配置",
    "成果",
    "图纸",
    "附件",
    "数据库",
    "必须",
    "应当",
    "不得",
    "允许",
    "流程",
    "清单",
  ]) {
    if (q.includes(keyword)) rawKeywords.add(keyword);
  }

  return {
    asksCode: /代码|编码|编号|[A-Za-z]\d{1,4}/.test(q),
    asksTableNo: /表\s*[A-Za-z]?\d|附表|哪.*表/.test(q),
    asksClause: /第[零一二三四五六七八九十百千0-9]+条|\d+(?:\.\d+){1,}|条文|条款/.test(q),
    asksDefinition: /定义|是什么|是指|所称|术语|含义/.test(q),
    asksIndicator: /指标|面积|数量|规模|服务半径|容积率|绿地率|密度|高度|多少/.test(q),
    asksConfiguration: /配置|配建|设置|标准|控制要求/.test(q),
    asksDeliverable: /成果|提交|编制内容|包括哪些/.test(q),
    asksDrawing: /图纸|图则|图纸目录|比例尺/.test(q),
    asksAttachmentOrDatabase: /附件|附表|数据库|材料/.test(q),
    asksObligation: /必须|应当|应|不得|禁止|严禁|宜|可|允许|能否|是否/.test(q),
    asksProcedure: /流程|程序|步骤|怎么办|如何办理|阶段/.test(q),
    asksChecklist: /清单|事项|任务|问题清单|项目清单|政策清单/.test(q),
    hasNumericFilter: /\d|不小于|不少于|不低于|不大于|不超过|以上|以下|区间|范围/.test(q),
    rawKeywords: [...rawKeywords],
  };
}
