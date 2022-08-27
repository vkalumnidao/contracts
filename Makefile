.PHONY: test
test:
	NODE_OPTIONS=--no-experimental-fetch npx jest tests/**/*.spec.ts
