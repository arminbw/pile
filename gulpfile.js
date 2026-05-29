import gulp from "gulp";
import { deleteAsync } from "del";
import stripComments from "gulp-strip-comments";
import stripCssComments from "gulp-strip-css-comments";
import stripDebug from "gulp-strip-debug";

export function clean() {
   return deleteAsync(['build/**'], { dot: true });
}

function processJavascript() {
   return gulp
      .src(['src/service-worker.js', 'src/sidebar/panel.js', 'src/options/options.js'], { base: 'src/' })
      .pipe(stripDebug())
      .pipe(stripComments( { space:false, trim:true } ))
      .pipe(gulp.dest('./build/'));
}

function processOtherCode() {
   return gulp
      .src(['src/manifest.json', 'src/sidebar/*.html', 'src/options/*.html', 'src/_locales/**'], { base: 'src/' })
      .pipe(stripComments())
      .pipe(gulp.dest('build/'));
}

function processCss() {
   return gulp
      .src(['src/sidebar/*.css', 'src/options/*.css'], { base: 'src/' })
      .pipe(stripCssComments())
      .pipe(gulp.dest('build/'));
}

function moveAssets() {
   return gulp
      .src(['src/icons/**/*.*', 'src/sidebar/*.svg'], { base: 'src/' })
      .pipe(gulp.dest('build/'))
}

export const build = gulp.series(clean, gulp.parallel(processJavascript, processOtherCode, processCss, moveAssets));

