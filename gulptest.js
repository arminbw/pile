const gulp = require('gulp');
const stripDebug = require('gulp-strip-debug');

exports.default = () => (
	gulp.src('./src/sidebar/panel.js')
		.pipe(stripDebug())
		.pipe(gulp.dest('./gulpresult.js'))
);
