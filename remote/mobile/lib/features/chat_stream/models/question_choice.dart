class QuestionChoicePayload {
  final String toolCallId;
  final String question;
  final List<String> options;
  final bool isMultiSelect;
  final List<String> selectedOptions;
  final String customResponse;

  QuestionChoicePayload({
    required this.toolCallId,
    required this.question,
    required this.options,
    this.isMultiSelect = false,
    this.selectedOptions = const [],
    this.customResponse = '',
  });

  factory QuestionChoicePayload.fromJson(Map<String, dynamic> json) {
    return QuestionChoicePayload(
      toolCallId: json['toolCallId'] as String? ??
          json['requestId'] as String? ??
          json['callId'] as String? ??
          '',
      question: json['question'] as String? ?? '',
      options: (json['options'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          [],
      isMultiSelect: json['isMultiSelect'] as bool? ?? false,
      selectedOptions: (json['selectedOptions'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          [],
      customResponse: json['customResponse'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'toolCallId': toolCallId,
      'question': question,
      'options': options,
      'isMultiSelect': isMultiSelect,
      'selectedOptions': selectedOptions,
      'customResponse': customResponse,
    };
  }

  QuestionChoicePayload copyWith({
    String? toolCallId,
    String? question,
    List<String>? options,
    bool? isMultiSelect,
    List<String>? selectedOptions,
    String? customResponse,
  }) {
    return QuestionChoicePayload(
      toolCallId: toolCallId ?? this.toolCallId,
      question: question ?? this.question,
      options: options ?? this.options,
      isMultiSelect: isMultiSelect ?? this.isMultiSelect,
      selectedOptions: selectedOptions ?? this.selectedOptions,
      customResponse: customResponse ?? this.customResponse,
    );
  }
}
