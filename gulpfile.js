
/* File: gulpfile.js */

// grab gulp packages
const gulp  = require('gulp'),
    gutil = require('gulp-util'),
    decomment = require('gulp-decomment');
    streamqueue = require('streamqueue');
    removelogging = require("gulp-remove-logging");
    removeEmptyLines = require('gulp-remove-empty-lines');
    clean = require('gulp-clean');

gulp.task('default', ['clean'], () => {
    gulp.start('build');
});

// build
gulp.task('build', () => {
  return streamqueue({ objectMode: true },
    gulp.src(['src/manifest.json','./src/background.js', './src/sidebar/*.js', './src/sidebar/*.html', './src/_locales/**'], { base: 'src/' })
    .pipe(decomment({trim: true}))
    .pipe(removelogging())
    .pipe(removeEmptyLines())
    .pipe(gulp.dest('./build/')),
    gulp.src(['src/icons/**/*.*', 'src/sidebar/*.svg', 'src/sidebar/*.css'], { base: 'src/' })
    .pipe(gulp.dest('./build/'))
    )
});

// clean build
gulp.task('clean', function() {
  return gulp.src(['build/'], {read: false})
    .pipe(clean());
});