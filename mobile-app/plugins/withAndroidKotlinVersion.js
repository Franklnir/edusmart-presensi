const { withGradleProperties, withProjectBuildGradle } = require('@expo/config-plugins');

const KOTLIN_PROPERTY = 'android.kotlinVersion';

function withAndroidKotlinVersion(config, props = {}) {
  const kotlinVersion = props.kotlinVersion || '1.9.25';

  config = withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) => item.type !== 'property' || item.key !== KOTLIN_PROPERTY
    );
    config.modResults.push({
      type: 'property',
      key: KOTLIN_PROPERTY,
      value: kotlinVersion,
    });

    return config;
  });

  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = config.modResults.contents.replace(
        /classpath\(['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin['"]\)/,
        'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")'
      );
    }

    return config;
  });
}

module.exports = withAndroidKotlinVersion;
