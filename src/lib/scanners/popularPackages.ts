// Widely used npm packages that attackers most often imitate with lookalike names.
// Legitimate near-neighbours (react/preact, redis/redux, mysql/mysql2) are listed
// together so they never flag each other.
export const POPULAR_PACKAGES: readonly string[] = [
  // frameworks & UI
  'react', 'react-dom', 'preact', 'vue', 'svelte', 'angular', '@angular/core', 'next', 'nuxt',
  'gatsby', 'remix', 'astro', 'solid-js', 'jquery', 'bootstrap', 'tailwindcss', 'styled-components',
  'framer-motion', 'three', 'd3', 'chart.js', 'react-router', 'react-router-dom', 'redux',
  'react-redux', '@reduxjs/toolkit', 'zustand', 'mobx', 'recoil', 'jotai', 'immer', 'formik',
  'react-hook-form', 'classnames', 'clsx', 'react-query', '@tanstack/react-query', 'swr',
  // servers & http
  'express', 'koa', 'fastify', 'hapi', '@nestjs/core', 'body-parser', 'cors', 'helmet',
  'morgan', 'cookie-parser', 'express-session', 'multer', 'axios', 'node-fetch', 'got',
  'request', 'superagent', 'socket.io', 'socket.io-client', 'ws', 'http-proxy',
  'http-proxy-middleware', 'passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'jose',
  // data & databases
  'mongoose', 'mongodb', 'mysql', 'mysql2', 'pg', 'sequelize', 'typeorm', 'prisma',
  '@prisma/client', 'knex', 'redis', 'ioredis', 'sqlite3', 'better-sqlite3', 'graphql',
  'apollo-server', '@apollo/client', 'firebase', '@supabase/supabase-js', 'stripe',
  // utilities
  'lodash', 'lodash.merge', 'underscore', 'ramda', 'moment', 'dayjs', 'date-fns', 'luxon',
  'uuid', 'nanoid', 'chalk', 'colors', 'debug', 'commander', 'yargs', 'minimist', 'inquirer',
  'ora', 'dotenv', 'cross-env', 'rimraf', 'mkdirp', 'glob', 'globby', 'fs-extra', 'chokidar',
  'semver', 'async', 'bluebird', 'rxjs', 'qs', 'query-string', 'validator', 'joi', 'yup',
  'zod', 'ajv', 'crypto-js', 'node-forge', 'js-yaml', 'yaml', 'xml2js', 'cheerio', 'marked',
  'markdown-it', 'handlebars', 'ejs', 'pug', 'mustache', 'sharp', 'jimp', 'canvas',
  'puppeteer', 'playwright', 'nodemailer', 'winston', 'pino', 'bunyan', 'event-stream',
  'through2', 'readable-stream', 'node-ipc', 'ua-parser-js', 'coa', 'rc', 'core-js',
  'regenerator-runtime', 'tslib', 'ms', 'mime', 'mime-types', 'iconv-lite', 'safe-buffer',
  'form-data', 'cross-spawn', 'execa', 'shelljs', 'open', 'electron', 'jsdom', 'socks',
  // build & tooling
  'typescript', 'ts-node', 'tsx', 'webpack', 'webpack-cli', 'vite', 'rollup', 'esbuild',
  'parcel', 'babel-core', '@babel/core', '@babel/preset-env', 'babel-loader', 'swc',
  '@swc/core', 'eslint', 'prettier', 'jest', 'mocha', 'chai', 'sinon', 'vitest', 'cypress',
  'nodemon', 'pm2', 'husky', 'lint-staged', 'concurrently', 'npm-run-all', 'postcss',
  'autoprefixer', 'sass', 'less', 'css-loader', 'style-loader', 'html-webpack-plugin',
  '@types/node', '@types/react', 'eslint-config-next', 'lerna', 'nx', 'turbo',
];
