import nx from "@nx/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import storybook from "eslint-plugin-storybook";
import baseConfig from "../../eslint.config.mjs";

export default [...baseConfig, ...nx.configs["flat/react"], reactHooks.configs.flat["recommended-latest"], ...storybook.configs["flat/recommended"]];
