"use strict";

const gulp = require('gulp');
const del = require('del');
const stripComments = require('gulp-strip-comments');
const stripDebug = require('gulp-strip-debug');

function clean() {
   return del(['build/**/*']);
}

function processJavascript() {
   return gulp
      .src(['./src/background.js', './src/sidebar/*.js'], { base: 'src/' })
      .pipe(stripComments( { space:false, trim:true } ))
      .pipe(stripDebug())
      .pipe(gulp.dest('./build/'));
}

function processOtherCode() {
   // comments are not stripped from CSS as decomment still has troubles with regular expressions
   return gulp
      .src(['src/manifest.json', './src/sidebar/*.html', './src/_locales/**'], { base: 'src/' })
      .pipe(stripComments())
      .pipe(gulp.dest('./build/'));
}

function moveAssets() {
   return gulp
      .src(['src/icons/**/*.*', 'src/sidebar/*.svg',  'src/sidebar/*.css'], { base: 'src/' })
      .pipe(gulp.dest('./build/'))
}

const build = gulp.series(clean, gulp.parallel(processJavascript, processOtherCode, moveAssets));

exports.build = build;
exports.clean = clean;