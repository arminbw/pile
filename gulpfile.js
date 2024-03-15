import gulp from "gulp";
import {deleteAsync} from "del";
import stripComments from "gulp-strip-comments";
import stripDebug from "gulp-strip-debug";

export function clean() {
   return deleteAsync(['build/**'], '!build');
}

function processJavascript() {
   return gulp
      .src(['src/background.js', 'src/sidebar/panel.js'], { base: 'src/' })
      .pipe(stripDebug())
      .pipe(stripComments( { space:false, trim:true } ))
      .pipe(gulp.dest('./build/'));
}

function processOtherCode() {
   return gulp
      .src(['src/manifest.json', 'src/sidebar/*.html', 'src/_locales/**'], { base: 'src/' })
      .pipe(stripComments())
      .pipe(gulp.dest('build/'));
}

function moveAssets() {
   return gulp
      .src(['src/icons/**/*.*', 'src/sidebar/*.svg', 'src/sidebar/*.css'], { base: 'src/' })
      .pipe(gulp.dest('build/'))
}

export const build = gulp.series(clean, gulp.parallel(processJavascript, processOtherCode, moveAssets));

