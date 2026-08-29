import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Carte compacte affichant une question interactive résolue/répondue
/// dans le flux de la session IDE (fidèle à la capture Antigravity).
class ResolvedAskQuestionCard extends StatelessWidget {
  final String question;
  final String selectedAnswer;
  final String? questionCountLabel;
  final bool isWriteIn;

  const ResolvedAskQuestionCard({
    super.key,
    required this.question,
    required this.selectedAnswer,
    this.questionCountLabel,
    this.isWriteIn = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final countText = questionCountLabel ?? '1 question';
    final formattedAnswer = isWriteIn && !selectedAnswer.contains('(write-in)')
        ? '$selectedAnswer (write-in)'
        : selectedAnswer;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1B1C22) : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isDark ? const Color(0xFF2E303E) : scheme.outlineVariant.withValues(alpha: 0.7),
          width: 0.9,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // En-tête : [?] 1 question
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.help_outline_rounded,
                size: 14,
                color: isDark ? const Color(0xFF8B8D98) : scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Text(
                countText,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                  color: isDark ? const Color(0xFF8B8D98) : scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // Intitulé de la question en gras
          Text(
            question,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              color: isDark ? AppColors.inkPrimary : scheme.onSurface,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 8),

          // Réponse sélectionnée par l'utilisateur
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                formattedAnswer,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w400,
                  color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
