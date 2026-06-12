// 测试聚合入口：在单进程内运行所有 .test.ts（使 --experimental-strip-types 生效）。
// 新增测试文件后在此 import 一行即可。
// 运行：npm test
import "./tableConfidence.test.ts";
import "./p1Parse.test.ts";
import "./coordTables.test.ts";
import "./knowledgeObjects.test.ts";
import "./importParser.test.ts";
import "./exportResults.test.ts";
