#!/bin/bash
# Enforce make target usage — block direct tool invocations

read -r input
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')

case "$cmd" in
  *"./sqitch "*|*"sqitch deploy"*|*"sqitch revert"*|*"sqitch verify"*)
    echo '{"decision":"block","reason":"Use make db-up / make db-down / make db-verify instead of sqitch directly"}';;
  *"pg_prove "*|*"pg_prove")
    echo '{"decision":"block","reason":"Use make tap instead of pg_prove directly"}';;
  *"npx jest "*|*"npx jest"|*"jest --"*)
    echo '{"decision":"block","reason":"Use npm test instead of jest directly"}';;
esac
