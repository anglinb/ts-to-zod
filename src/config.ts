import inquirer, { DistinctQuestion } from "inquirer";
import { existsSync, outputFile } from "fs-extra";
import { join } from "path";
import { z } from "zod";
import { Subject } from "rxjs";
import prettier from "prettier";

export const getSchemaNameSchema = z
  .function()
  .args(z.string())
  .returns(z.string());

export const nameFilterSchema = z
  .function()
  .args(z.string())
  .returns(z.boolean());

export const configSchema = z
  .object({
    maxRun: z.number(),
    nameFilter: nameFilterSchema,
    getSchemaName: getSchemaNameSchema,
    keepComments: z.boolean(),
    input: z.string(),
    output: z.string(),
  })
  .partial();

export const configsSchema = z.array(
  configSchema.and(z.object({ name: z.string() }))
);

export const tsToZodconfigSchema = z.union([configSchema, configsSchema]);

export type Config = z.infer<typeof configSchema>;
export type Configs = z.infer<typeof configsSchema>;
export type TsToZodConfig = z.infer<typeof tsToZodconfigSchema>;

/**
 * Create `ts-to-zod.config.js` file.
 *
 * @param path
 * @returns `true` if the file was created
 */
export async function createConfig(configPath: string) {
  if (existsSync(configPath)) {
    const { answer } = await inquirer.prompt<{ answer: boolean }>({
      type: "confirm",
      name: "answer",
      message:
        "ts-to-zod.config.js already exists, do you want to override it?",
    });
    if (!answer) {
      return false;
    }
  }

  const project = join(__dirname, "../tsconfig.json");
  const dev = existsSync(project);

  let answers: Answers | undefined;
  let prefix: string | undefined;

  const getOutputDefault = () => {
    if (answers?.mode === "single") {
      return answers.config.input.replace(/\.ts(x)?$/, ".zod.ts$1");
    } else if (answers?.mode === "multi") {
      return answers.config[answers.config.length - 1].input.replace(
        /\.ts(x)?$/,
        ".zod.ts$1"
      );
    }
  };

  const prompts = new Subject<DistinctQuestion>();
  let i = 0; // Trick to ask the same question (`askAnswered` is not in the types…)

  const askForInput = () => {
    prompts.next({
      type: "input",
      name: `input-${i}`,
      message: "Where is your file with types?",
      default: prefix ? `${prefix}.ts` : undefined,
      prefix: prefix ? `[${prefix}]` : undefined,
    });
  };

  const askForOutput = (prefix?: string) => {
    prompts.next({
      type: "input",
      name: `output-${i}`,
      message: "Where do you want to save the generated zod schemas?",
      default: getOutputDefault(),
      prefix: prefix ? `[${prefix}]` : undefined,
    });
  };

  const askForConfigName = () => {
    prompts.next({
      type: "input",
      name: `configName-${i}`,
      message: "How should we call your configuration?",
    });
  };

  const askForOneMore = () => {
    prompts.next({
      type: "confirm",
      name: `oneMore-${i++}`,
      message: "Do you want to add another config?",
    });
  };

  inquirer.prompt(prompts).ui.process.subscribe(
    (q) => {
      // inquirer type are a bit broken…
      const question = q as { name: string; answer: string };

      if (question.name === "mode") {
        if (question.answer.toLowerCase().includes("single")) {
          answers = { mode: "single", config: { input: "", output: "" } };
          askForInput();
        } else {
          answers = { mode: "multi", config: [] };
          askForConfigName();
        }
      }

      if (question.name.startsWith("input")) {
        if (answers?.mode === "single") {
          answers.config.input = question.answer;
        } else if (answers?.mode === "multi") {
          answers.config[answers.config.length - 1].input = question.answer;
        }
        askForOutput();
      }

      if (question.name.startsWith("output")) {
        if (answers?.mode === "single") {
          answers.config.output = question.answer;
          prompts.complete();
        } else if (answers?.mode === "multi") {
          answers.config[answers.config.length - 1].output = question.answer;
          askForOneMore();
        }
      }

      if (question.name.startsWith("configName")) {
        if (answers?.mode === "multi") {
          answers.config.push({
            name: question.answer,
            input: "",
            output: "",
          });
        }
        prefix = question.answer;
        askForInput();
      }

      if (question.name.startsWith("oneMore")) {
        if (question.answer) {
          askForConfigName();
        } else {
          prompts.complete();
        }
      }
    },
    (err) => console.error(err)
  );

  // First question to start the flow
  prompts.next({
    type: "list",
    name: "mode",
    message: "What kind of configuration do you need?",
    choices: [
      { key: "single", value: "Single configuration" },
      { key: "multi", value: "Multiple configurations" },
    ],
  });

  await prompts.toPromise();

  const header = `/**
 * ts-to-zod configuration.
 *
 * @type {${
   dev ? 'import("./src/config")' : 'import("ts-to-zod")'
 }.TsToZodConfig}
 */
module.exports = `;

  if (answers) {
    await outputFile(
      configPath,
      prettier.format(header + JSON.stringify(answers.config), {
        parser: "babel",
      }),
      "utf-8"
    );
    return true;
  }

  return false;
}

type Answers =
  | {
      mode: "single";
      config: {
        input: string;
        output: string;
      };
    }
  | {
      mode: "multi";
      config: Array<{ name: string; input: string; output: string }>;
    };
