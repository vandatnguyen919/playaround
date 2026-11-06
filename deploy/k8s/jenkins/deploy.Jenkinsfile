// CD only. GitHub Actions tests and publishes images; this ships one commit's images to
// the VM. The poll starts it (values.yaml). Runbook: README.md in this folder.
//
// No agent pod is held while waiting for approval, so a rollback can still run then.

def sha
def digests

def by() { return "${env.JOB_NAME}/${env.BUILD_NUMBER}" }

def short12(String s) { return s.length() > 12 ? s.substring(0, 12) : s }

def notify(String subject) {
  withCredentials([
    usernamePassword(credentialsId: 'notify-smtp', usernameVariable: 'NOTIFY_USER', passwordVariable: 'NOTIFY_PASSWORD'),
    string(credentialsId: 'notify-recipient', variable: 'NOTIFY_TO'),
  ]) {
    withEnv(["NOTIFY_SUBJECT=${subject}"]) {
      sh 'sh deploy/k8s/jenkins/notify.sh'
    }
  }
}

def smoke() {
  timeout(time: 15, unit: 'MINUTES') {
    sh '/tools/node deploy/compose/smoke-public.mjs "$VM_TARGET" smoke'
  }
}

node('deploy') {
  stage('Checkout') {
    checkout scm
    sha = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
    currentBuild.description = short12(sha)
  }
  try {
    stage('CI, images and provenance') {
      withEnv(["SHA=${sha}"]) {
        // CI_WAIT_MINUTES in cd-gate.mjs ends first, with a clearer message.
        timeout(time: 75, unit: 'MINUTES') {
          sh '/tools/node deploy/k8s/jenkins/cd-gate.mjs "$SHA" digests.txt'
        }
      }
      digests = readFile('digests.txt').trim()
    }
    stash name: 'cd', includes: 'deploy/k8s/jenkins/**,deploy/compose/smoke-public.mjs,smoke.mjs'
    notify("Approve deploy of ${short12(sha)}")
  } catch (e) {
    notify("Not deployed: ${short12(sha)} did not pass CI or provenance")
    throw e
  }
}

stage('Approval') {
  // Unanswered for a day: the build ends as aborted and nothing changes.
  timeout(time: 24, unit: 'HOURS') {
    input id: 'Deploy', message: "Deploy ${sha} to the VM?", ok: 'Deploy'
  }
}

node('deploy') {
  unstash 'cd'
  withCredentials([sshUserPrivateKey(credentialsId: 'vm-deploy-key', keyFileVariable: 'VM_KEY')]) {
    sh 'sh deploy/k8s/jenkins/vm-ssh-config.sh'
    withEnv(["SHA=${sha}", "DIGESTS=${digests}", "BY=${by()}"]) {
      try {
        stage('Deploy') {
          timeout(time: 25, unit: 'MINUTES') {
            sh 'ssh "$VM_TARGET" deploy "$SHA" $DIGESTS "$BY"'
          }
        }
        stage('Smoke') {
          smoke()
        }
        stage('Record') {
          sh 'ssh "$VM_TARGET" mark-good "$SHA" "$BY"'
        }
        notify("Deployed ${short12(sha)}: smoke passed")
      } catch (e) {
        // Must not fail itself, or an unreachable VM would end the build with no mail.
        def running = sh(script: 'ssh "$VM_TARGET" current || echo unreachable', returnStdout: true).trim()
        if (running == 'unreachable') {
          notify("Cannot reach the VM while deploying ${short12(sha)}: what is running is unknown, check it by hand")
          throw e
        }
        if (running != sha) {
          // Failed before the switch: pull, or a compose file that does not fit .env.
          notify("Not deployed: ${short12(sha)} failed before anything changed")
          throw e
        }
        stage('Roll back') {
          try {
            sh 'ssh "$VM_TARGET" note "$SHA" deploy-or-smoke-failed "$BY"'
            timeout(time: 25, unit: 'MINUTES') {
              sh 'ssh "$VM_TARGET" rollback "$BY"'
            }
            // Smoke signs in 8 times, and the edge allows 10 a minute per address.
            sleep time: 70, unit: 'SECONDS'
            smoke()
            sh 'ssh "$VM_TARGET" note "$(ssh "$VM_TARGET" current)" rollback-verified "$BY"'
          } catch (rollbackError) {
            notify("ROLLBACK FAILED after ${short12(sha)}: the site may be down")
            throw rollbackError
          }
        }
        def restored = sh(script: 'ssh "$VM_TARGET" current', returnStdout: true).trim()
        currentBuild.description = "${short12(sha)} rolled back to ${short12(restored)}"
        notify("Rolled back: ${short12(sha)} failed, now running ${short12(restored)}")
        throw e
      }
    }
  }
}
